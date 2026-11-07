# 音声シーク回帰テスト素材

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

`seek-stereo.flac` は自動回帰テスト用に生成した合成音声です。ユーザーの録音や市販の音楽は含みません。左右のチャンネルはそれぞれ 317 Hz と 701 Hz の正弦波で、振幅 25%、48 kHz、16 ビット、長さ 4.25 秒です。

リポジトリのルートから FFmpeg で再生成できます。

```powershell
ffmpeg -f lavfi -i 'aevalsrc=0.25*sin(2*PI*317*t)|0.25*sin(2*PI*701*t):s=48000:d=4.25' -sample_fmt s16 -c:a flac -map_metadata -1 -y desktop/tests/fixtures/seek-stereo.flac
```

この素材には意図的に FLAC の `SEEKTABLE` メタデータブロックを含めていません。回帰テストはその条件を確認し、前後および小数秒へのシーク結果を全体の順次デコードと比較して、最後の音声フレームも検証します。左右の波形を変えることで、インターリーブされたチャンネルのずれも検出できます。

テストコマンドと実音声出力によるシーク確認ツールは[デスクトップガイド](../../README.ja.md)を参照してください。ファイルを再生成しただけでは、回帰テストの成功を確認したことにはなりません。
