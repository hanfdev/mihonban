# 音訊定位回歸測試素材

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

`seek-stereo.flac` 是為自動回歸測試產生的合成音訊，不含使用者錄音或商業音樂。左右聲道分別為 317 Hz 和 701 Hz 正弦波，振幅為 25%，取樣率 48 kHz，16 位元，長度 4.25 秒。

在儲存庫根目錄使用 FFmpeg 重新產生：

```powershell
ffmpeg -f lavfi -i 'aevalsrc=0.25*sin(2*PI*317*t)|0.25*sin(2*PI*701*t):s=48000:d=4.25' -sample_fmt s16 -c:a flac -map_metadata -1 -y desktop/tests/fixtures/seek-stereo.flac
```

此檔案刻意不包含 FLAC `SEEKTABLE` 中繼資料區塊。回歸測試確認此條件，將前後定位及小數秒定位的結果與完整循序解碼比較，並驗證最後一個音訊影格。左右聲道不同的波形也能偵測交錯聲道意外錯位。

測試命令及真實音訊輸出的定位檢查工具見[桌面端指南](../../README.zh-Hant.md)。僅重新產生檔案不代表回歸測試已通過。
