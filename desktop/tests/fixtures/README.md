# Audio seek regression fixture

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

`seek-stereo.flac` is synthetic audio created for automated regression tests.
It contains no user recordings or commercial music: the left and right channels
are separate 317 Hz and 701 Hz sine waves at 25% amplitude, 48 kHz, 16-bit,
4.25 seconds long.

Regenerate it from the repository root with FFmpeg:

```powershell
ffmpeg -f lavfi -i 'aevalsrc=0.25*sin(2*PI*317*t)|0.25*sin(2*PI*701*t):s=48000:d=4.25' -sample_fmt s16 -c:a flac -map_metadata -1 -y desktop/tests/fixtures/seek-stereo.flac
```

The fixture deliberately has no FLAC `SEEKTABLE` metadata block. The regression
test checks this condition, compares forward/backward and fractional-second
seeks against a full sequential decode, and verifies the final audio frame.
The distinct channels also detect accidental interleaved-channel misalignment.

See the [desktop guide](../../README.md) for test commands and the real-output seek probe. Regenerating the file alone does not verify the regression tests.
