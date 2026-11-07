# 오디오 탐색 회귀 테스트 자료

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

`seek-stereo.flac`는 자동 회귀 테스트용으로 생성한 합성 오디오입니다. 사용자 녹음이나 상업 음악은 포함하지 않습니다. 왼쪽과 오른쪽 채널은 각각 317 Hz와 701 Hz 사인파이며 진폭 25%, 48 kHz, 16비트, 길이 4.25초입니다.

저장소 루트에서 FFmpeg로 다시 생성합니다.

```powershell
ffmpeg -f lavfi -i 'aevalsrc=0.25*sin(2*PI*317*t)|0.25*sin(2*PI*701*t):s=48000:d=4.25' -sample_fmt s16 -c:a flac -map_metadata -1 -y desktop/tests/fixtures/seek-stereo.flac
```

이 자료에는 의도적으로 FLAC `SEEKTABLE` 메타데이터 블록이 없습니다. 회귀 테스트는 이 조건을 확인하고 앞뒤 및 소수 초 위치 탐색을 전체 순차 디코딩과 비교하며 마지막 오디오 프레임도 검증합니다. 서로 다른 채널 파형은 인터리브 채널의 우발적인 정렬 오류도 탐지합니다.

테스트 명령과 실제 오디오 출력 탐색 도구는 [데스크톱 안내](../../README.ko.md)를 참고하세요. 파일을 다시 만드는 것만으로 회귀 테스트 통과를 검증한 것은 아닙니다.
