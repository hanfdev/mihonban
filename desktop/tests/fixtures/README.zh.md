# 音频定位回归测试素材

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

`seek-stereo.flac` 是为自动回归测试生成的合成音频，不含用户录音或商业音乐。左右声道分别为 317 Hz 和 701 Hz 正弦波，振幅为 25%，采样率 48 kHz，16 位，长度 4.25 秒。

在仓库根目录使用 FFmpeg 重新生成：

```powershell
ffmpeg -f lavfi -i 'aevalsrc=0.25*sin(2*PI*317*t)|0.25*sin(2*PI*701*t):s=48000:d=4.25' -sample_fmt s16 -c:a flac -map_metadata -1 -y desktop/tests/fixtures/seek-stereo.flac
```

此文件刻意不包含 FLAC `SEEKTABLE` 元数据块。回归测试确认这一条件，将前后定位及小数秒定位的结果与完整顺序解码进行比较，并验证最后一个音频帧。左右声道不同的波形还能检测交错声道意外错位。

测试命令和真实音频输出的定位检查工具见[桌面端指南](../../README.zh.md)。仅重新生成文件不代表回归测试已经通过。
