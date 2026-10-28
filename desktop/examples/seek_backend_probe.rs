use anyhow::{Context, Result};
use rodio::{Decoder, OutputStreamBuilder, Sink, Source};
use std::{
    fs::File,
    io::BufReader,
    path::PathBuf,
    thread,
    time::{Duration, Instant},
};

#[path = "../src/player.rs"]
mod player;

fn open(path: &PathBuf) -> Result<Decoder<BufReader<File>>> {
    Ok(Decoder::try_from(File::open(path)?)?)
}

fn main() -> Result<()> {
    let paths: Vec<PathBuf> = std::env::args_os().skip(1).map(PathBuf::from).collect();
    anyhow::ensure!(!paths.is_empty(), "pass complete cached FLAC files");
    for path in &paths {
        let mut decoder = open(path)?;
        let rate = decoder.sample_rate();
        let channels = decoder.channels();
        let duration = decoder.total_duration().context("FLAC has no duration")?;
        println!(
            "FILE {} rate={rate} channels={channels} duration={duration:?}",
            path.file_name().unwrap().to_string_lossy()
        );
        let reference: Vec<_> = open(path)?.collect();
        let decoded_seconds = reference.len() as f64 / f64::from(rate) / f64::from(channels);
        println!(
            "FULL DECODE frames={} seconds={decoded_seconds:.9}",
            reference.len() / usize::from(channels)
        );
        anyhow::ensure!(
            (decoded_seconds - duration.as_secs_f64()).abs() < 1.0 / f64::from(rate),
            "decoded sample count differs from metadata; cache file may be incomplete"
        );
        for millis in [20_125, 70_375, 5_005, 120_750, 35_500, 0] {
            let target = Duration::from_millis(millis);
            if target + Duration::from_secs(2) >= duration {
                continue;
            }
            let started = Instant::now();
            decoder
                .try_seek(target)
                .map_err(|error| anyhow::anyhow!("{error}"))?;
            let actual: Vec<_> = decoder.by_ref().take(1024).collect();
            let offset = (millis * u64::from(rate) / 1000 * u64::from(channels)) as usize;
            let expected = &reference[offset..offset + 1024];
            anyhow::ensure!(
                actual == expected,
                "decoder samples differ at {target:?} for {}",
                path.display()
            );
            println!(
                "DECODER target={target:?} sample_match=true elapsed_ms={}",
                started.elapsed().as_millis()
            );
        }
    }
    let mut stream = OutputStreamBuilder::open_default_stream()?;
    stream.log_on_drop(false);
    let sink = Sink::connect_new(stream.mixer());
    sink.set_volume(0.0);
    sink.append(open(&paths[0])?);
    thread::sleep(Duration::from_millis(100));
    for paused in [false, true, false] {
        if paused {
            sink.pause();
        } else {
            sink.play();
        }
        for target in [20, 70, 5, 120, 35, 0] {
            let started = Instant::now();
            sink.try_seek(Duration::from_secs(target))
                .map_err(|error| anyhow::anyhow!("{error}"))?;
            let immediate = sink.get_pos();
            thread::sleep(Duration::from_millis(140));
            let later = sink.get_pos();
            println!("SINK paused={paused} target={target}s immediate={immediate:?} later={later:?} seek_ms={}", started.elapsed().as_millis());
            anyhow::ensure!(
                (later.as_secs_f64() - target as f64).abs() < 0.6,
                "sink rebound"
            );
        }
    }
    sink.stop();
    let mut app_player = player::AudioPlayer::with_handle(player::PlaybackHandle::default());
    app_player.play_file("probe", paths[0].clone(), false)?;
    app_player.set_volume(0.0);
    thread::sleep(Duration::from_millis(100));
    for paused in [false, true, false] {
        if app_player.is_playing() == paused {
            app_player.toggle();
        }
        for target in [20, 70, 5, 120, 35, 0] {
            app_player.seek(Duration::from_secs(target))?;
            thread::sleep(Duration::from_millis(140));
            let actual = app_player.position();
            anyhow::ensure!(
                (actual.as_secs_f64() - target as f64).abs() < 0.6,
                "app player rebound"
            );
            println!("PLAYER paused={paused} target={target}s actual={actual:?}");
        }
        if paused {
            anyhow::ensure!(
                !app_player.is_playing(),
                "seek unexpectedly resumed paused audio"
            );
            let position = app_player.position();
            thread::sleep(Duration::from_millis(1100));
            anyhow::ensure!(
                app_player.position() == position,
                "paused position continued advancing"
            );
            println!("PLAYER paused position remains stable for 1100 ms");
        }
    }
    app_player.seek(Duration::from_secs(60))?;
    thread::sleep(Duration::from_millis(2300));
    let actual = app_player.position();
    anyhow::ensure!(
        actual > Duration::from_secs(61) && actual < Duration::from_secs(64),
        "seek reverts after override expires: {actual:?}"
    );
    let duration = open(&paths[0])?
        .total_duration()
        .context("FLAC has no duration")?;
    app_player.seek(duration.saturating_sub(Duration::from_millis(250)))?;
    let deadline = Instant::now() + Duration::from_secs(2);
    while !app_player.finished() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(20));
    }
    anyhow::ensure!(
        app_player.finished(),
        "near-end seek failed to finish naturally"
    );
    app_player.play_file("probe", paths[0].clone(), false)?;
    app_player.set_volume(0.0);
    app_player.toggle();
    thread::sleep(Duration::from_millis(100));
    app_player.seek(duration.saturating_sub(Duration::from_millis(250)))?;
    let paused_position = app_player.position();
    thread::sleep(Duration::from_millis(1100));
    anyhow::ensure!(
        !app_player.is_playing() && !app_player.finished(),
        "paused near-end seek finished early"
    );
    anyhow::ensure!(
        app_player.position() == paused_position,
        "paused near-end position advanced"
    );
    app_player.toggle();
    let deadline = Instant::now() + Duration::from_secs(2);
    while !app_player.finished() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(20));
    }
    anyhow::ensure!(
        app_player.finished(),
        "resuming near EOF failed to finish naturally"
    );
    app_player.play_file("probe", paths[0].clone(), false)?;
    app_player.set_volume(0.0);
    thread::sleep(Duration::from_millis(100));
    app_player.seek(duration + Duration::from_secs(1))?;
    let deadline = Instant::now() + Duration::from_secs(2);
    while !app_player.finished() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(20));
    }
    anyhow::ensure!(
        app_player.finished(),
        "beyond-end seek failed to finish the final audio frame"
    );
    app_player.stop();
    println!("PASS exact fractional FLAC samples, playing/paused seeks, stable paused position, resumed playback and end-of-track completion");
    Ok(())
}
