//! Compare texture payloads for an existing local cache without network access.

#[allow(dead_code)]
#[path = "../src/app/texture_cache.rs"]
mod texture_cache;

use anyhow::{bail, Context, Result};
use image::ImageReader;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, path::PathBuf};
use texture_cache::TextureCache;

const MIB: usize = 1024 * 1024;

#[derive(Deserialize)]
struct Manifest {
    entries: BTreeMap<String, CacheEntry>,
}

#[derive(Deserialize)]
struct CacheEntry {
    file: String,
}

struct Sample {
    id: String,
    gallery: bool,
    bytes: usize,
}

fn fit_edge(width: u32, height: u32, edge: u32) -> (usize, usize) {
    if width.max(height) <= edge {
        return (width as usize, height as usize);
    }
    let scale = f64::from(edge) / f64::from(width.max(height));
    (
        (f64::from(width) * scale).round().max(1.0) as usize,
        (f64::from(height) * scale).round().max(1.0) as usize,
    )
}

fn rgba_bytes(width: usize, height: usize) -> usize {
    width.saturating_mul(height).saturating_mul(4)
}

#[derive(Default, Serialize)]
struct Report {
    cover_and_artist_images: usize,
    cover_images: usize,
    artist_images: usize,
    gallery_images: usize,
    rejected_or_invalid_images: usize,
    legacy_texture_payload_bytes: usize,
    legacy_cover_texture_payload_bytes: usize,
    legacy_artist_texture_payload_bytes: usize,
    resized_texture_payload_without_eviction_bytes: usize,
    resized_cover_texture_payload_without_eviction_bytes: usize,
    resized_artist_texture_payload_without_eviction_bytes: usize,
    cover_budget_bytes: usize,
    gallery_budget_bytes: usize,
    bounded_peak_texture_payload_bytes: usize,
    bounded_final_texture_payload_bytes: usize,
    bounded_final_texture_entries: usize,
    simulated_admissions: usize,
    simulated_cache_hits: usize,
    simulated_admission_rejections: usize,
}

fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let Some(root) = args.next().map(PathBuf::from) else {
        bail!(
            "usage: texture_memory_probe <cache-directory> [cover-budget-MiB] [gallery-budget-MiB]"
        );
    };
    let cover_budget = args.next().map_or(Ok(72), |n| n.parse::<usize>())? * MIB;
    let gallery_budget = args.next().map_or(Ok(32), |n| n.parse::<usize>())? * MIB;
    if args.next().is_some() || cover_budget == 0 || gallery_budget == 0 {
        bail!("provide a cache directory and positive memory budgets");
    }
    let manifest: Manifest = serde_json::from_slice(
        &fs::read(root.join("index.json")).context("cannot read the local cache index")?,
    )
    .context("cannot decode the local cache index")?;
    let mut report = Report {
        cover_budget_bytes: cover_budget,
        gallery_budget_bytes: gallery_budget,
        ..Report::default()
    };
    let mut samples = Vec::new();
    for (key, entry) in manifest.entries {
        let gallery = key.contains(":image:");
        let artist = key.contains(":artist:");
        if !(gallery || key.contains(":cover:") || artist) {
            continue;
        }
        let file = PathBuf::from(&entry.file);
        if file.components().count() != 1 || file.file_name().is_none() {
            report.rejected_or_invalid_images += 1;
            continue;
        }
        let path = root.join(file);
        let result = (|| -> Result<(usize, usize)> {
            let (width, height) = ImageReader::open(&path)?
                .with_guessed_format()?
                .into_dimensions()?;
            let encoded_bytes = fs::metadata(&path)?.len() as usize;
            if encoded_bytes > 32 * MIB
                || u64::from(width) * u64::from(height) * 4 > 96 * MIB as u64
            {
                bail!("image exceeds production decode limits");
            }
            if gallery {
                let (w, h) = fit_edge(width, height, 2048);
                Ok((
                    rgba_bytes(width as usize, height as usize),
                    rgba_bytes(w, h),
                ))
            } else {
                let (w, h) = fit_edge(width, height, 512);
                let original = rgba_bytes(w, h);
                let muted = if artist { 0 } else { original };
                Ok((
                    rgba_bytes(width as usize, height as usize) + muted + 64 * 64 * 4,
                    original + muted + 64 * 64 * 4,
                ))
            }
        })();
        let Ok((legacy_bytes, prepared_bytes)) = result else {
            report.rejected_or_invalid_images += 1;
            continue;
        };
        if gallery {
            report.gallery_images += 1;
        } else {
            report.cover_and_artist_images += 1;
            if artist {
                report.artist_images += 1;
                report.legacy_artist_texture_payload_bytes += legacy_bytes;
                report.resized_artist_texture_payload_without_eviction_bytes += prepared_bytes;
            } else {
                report.cover_images += 1;
                report.legacy_cover_texture_payload_bytes += legacy_bytes;
                report.resized_cover_texture_payload_without_eviction_bytes += prepared_bytes;
            }
        }
        report.legacy_texture_payload_bytes += legacy_bytes;
        report.resized_texture_payload_without_eviction_bytes += prepared_bytes;
        samples.push(Sample {
            id: samples.len().to_string(),
            gallery,
            bytes: prepared_bytes,
        });
    }
    let mut covers = TextureCache::new(cover_budget);
    let mut gallery = TextureCache::new(gallery_budget);
    // Simulate three complete visits, with at most 24 images visible per frame.
    for pass in 0..3 {
        let order: Vec<_> = if pass % 2 == 0 {
            samples.iter().collect()
        } else {
            samples.iter().rev().collect()
        };
        for visible in order.chunks(24) {
            covers.begin_frame();
            gallery.begin_frame();
            for sample in visible {
                let cache = if sample.gallery {
                    &mut gallery
                } else {
                    &mut covers
                };
                if cache.get(&sample.id).is_some() {
                    report.simulated_cache_hits += 1;
                } else if cache.insert(sample.id.clone(), (), sample.bytes) {
                    report.simulated_admissions += 1;
                } else {
                    report.simulated_admission_rejections += 1;
                }
                report.bounded_peak_texture_payload_bytes = report
                    .bounded_peak_texture_payload_bytes
                    .max(covers.bytes() + gallery.bytes());
            }
        }
    }
    report.bounded_final_texture_payload_bytes = covers.bytes() + gallery.bytes();
    report.bounded_final_texture_entries = covers.len() + gallery.len();
    println!("{}", serde_json::to_string_pretty(&report)?);
    eprintln!("Metrics describe RGBA texture payloads, not process RSS or GPU-driver overhead. No URLs or image identifiers are reported.");
    Ok(())
}
