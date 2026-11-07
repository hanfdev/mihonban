# iPhone 및 iPad용 Mihonban

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

기존 Mihonban 서버에 연결하는 네이티브 SwiftUI 클라이언트로, SFBAudioEngine을 사용해 재생합니다. 현재 미리보기 버전은 0.2.0이며 iOS/iPadOS 17 이상이 필요합니다. 서버를 호스팅하지 않으며 음악 감상 화면에 WebView를 사용하지 않습니다.

## 화면 미리보기

iPhone 및 iPad 시뮬레이터에서 촬영한 실제 네이티브 iOS 화면입니다. 가상의 데모 데이터와 앱에 내장된 기본 표지를 사용합니다. [촬영 안내](../docs/images/README.ko.md).

| iPhone 라이브러리 | iPhone 앨범 상세 | iPhone 플레이어 |
|:---:|:---:|:---:|
| <img src="../docs/images/ios-library.webp" height="420" alt="iPhone 라이브러리"> | <img src="../docs/images/ios-album.webp" height="420" alt="iPhone 앨범 상세"> | <img src="../docs/images/ios-player.webp" height="420" alt="iPhone 플레이어"> |

**iPad 가로 화면 앨범 상세**

![iPad 가로 화면 앨범 상세](../docs/images/ios-ipad-album.webp)

## 연결 및 재생

서버 루트 URL(예: `https://music.example.com`)과 청취자 또는 관리자 암호를 입력하세요. 서버에서 게스트 접근을 허용한 경우에만 암호를 비울 수 있습니다. 선택 사항인 암호 저장 스위치는 재연결할 때 사용할 암호를 키체인에 저장합니다. 로컬 서버에는 컴퓨터의 LAN 주소를 사용하세요. 휴대폰의 `localhost`는 휴대폰 자체를 가리킵니다. 로컬 HTTP 세션은 서버에서 `DEV_INSECURE_COOKIE=1` 설정이 필요하며, 원격 접근에는 HTTPS를 사용하세요.

- 앨범, 곡, 아티스트, 공유 즐겨찾기를 탐색하며 검색, 장르 필터, 정렬, 여러 아티스트 크레딧과 관련 앨범을 지원합니다.
- 네이티브 Markdown 리더로 앨범과 아티스트 소개를 읽고, 앨범 이미지를 탐색·확대하며, 시스템 공유 시트로 앨범과 곡 링크를 공유할 수 있습니다.
- 미니 플레이어, 전체 플레이어, 편집 가능한 대기열, 탐색, 셔플, 반복을 사용합니다. 백그라운드 오디오, 잠금 화면 제어, 시스템 오디오 출력 선택은 iOS 네이티브 기능을 사용합니다.
- 앨범을 저장해 오프라인으로 재생합니다. 다운로드 진행률을 표시하고 실패한 전송을 재시도할 수 있으며, 완료된 다운로드는 자동 캐시와 별도로 저장합니다. 앱이 일시 중단되어도 백그라운드 전송을 계속할 수 있지만 강제 종료하면 중단됩니다.
- 서버에 연결할 수 없어도 이전에 인증한 라이브러리와 다운로드한 음악을 다시 열 수 있습니다. 서버가 세션을 명시적으로 거부하면 다시 로그인해야 합니다.
- 시스템, 밝게, 어둡게 모드를 선택하고 자동 캐시를 256 MB~4 GB(기본 1 GB)로 조정하거나 끌 수 있습니다. 이 캐시를 지워도 명시적으로 다운로드한 파일은 유지됩니다.
- 다음 곡 미리 불러오기는 끄기, 자동(Wi-Fi), 항상 중에서 선택합니다. 기본값인 자동은 셀룰러, 요금제에 따라 과금되는 연결, 저데이터 모드를 피합니다. 대기열의 다음 곡만 준비하며 영구 캐시를 꺼도 사용할 수 있습니다.
- 관리자는 공유 즐겨찾기, 앨범 메타데이터와 표지, 앨범 표시/숨김을 변경하고 저장된 파일 포함 여부를 확인한 후 삭제할 수 있습니다. 전체 서버 설정, 일괄 가져오기/이전, 브라우저를 이용한 RYM 업데이트는 Web 앱에서 수행합니다.

화면은 영어, 일본어, 한국어, 프랑스어, 스페인어, 중국어 간체 및 번체를 지원합니다. 세로·가로 화면, Dynamic Type, iPad 레이아웃에는 각각 회귀 테스트가 있습니다. 형식 지원은 SFBAudioEngine과 포함된 코덱에 따라 달라지며, 테스트 모음에서 합성 MP3, FLAC, Vorbis의 디코딩과 탐색을 검증합니다.

## 빌드

macOS, 소스에서 사용하는 Swift 6.2 언어 기능을 지원하는 Xcode, XcodeGen, Python 3, FFmpeg가 필요합니다. [iOS 워크플로](../.github/workflows/mobile.yml)에 CI의 정확한 실행 환경과 Xcode 선택이 기록되어 있습니다(현재 `macos-26`, Xcode 26.6). 소스 준비 및 빌드 명령은 저장소 루트에서 실행하세요.

```sh
brew install xcodegen ffmpeg
python3 -I ios/tools/check-l10n.py
python3 -I ios/tools/check-fonts.py
mkdir -p ios/TestFixtures ios/Resources/ThirdParty
ffmpeg -v error -f lavfi -i 'sine=frequency=440:duration=8:sample_rate=44100' -ac 2 -c:a libmp3lame -q:a 3 ios/TestFixtures/tone.mp3
ffmpeg -v error -f lavfi -i 'sine=frequency=440:duration=8:sample_rate=44100' -ac 2 -c:a flac ios/TestFixtures/tone.flac
ffmpeg -v error -f lavfi -i 'sine=frequency=440:duration=8:sample_rate=44100' -ac 2 -c:a vorbis -strict experimental -q:a 4 ios/TestFixtures/tone.ogg
xcodegen generate --spec ios/project.yml
xcodebuild -resolvePackageDependencies -project ios/Mihonban.xcodeproj -scheme Mihonban -clonedSourcePackagesDirPath .spm
python3 -I ios/tools/acknowledgements.py .spm/checkouts ios/Resources/ThirdParty/Acknowledgements.txt
xcodegen generate --spec ios/project.yml
open ios/Mihonban.xcodeproj
```

SFBAudioEngine은 `project.yml`에서 특정 리비전으로 고정되어 있습니다. 검토된 `ios/Package.resolved`가 제공되면 CI와 마찬가지로 패키지를 확인하기 전에 `ios/Mihonban.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/`으로 복사하세요. CI는 확인된 의존성 잠금 파일을 아티팩트에 포함합니다. 생성된 Xcode 프로젝트, 의존성 체크아웃, 합성 오디오와 빌드 결과는 Git에서 제외하며, 제공되는 아이콘, 글꼴, 번역 카탈로그와 검색 테이블은 소스 자산입니다.

iPhone 또는 iPad 시뮬레이터를 선택하고 Mihonban scheme을 실행하세요. 실제 기기에서는 개발 팀과 서명 설정을 직접 구성해야 합니다. CI는 **서명되지 않은 IPA**를 생성하므로 다운로드한 뒤에도 적절한 서명 또는 사이드로딩 절차를 거쳐야 설치할 수 있습니다. 워크플로는 체크섬, 제삼자 고지와 다시 링크할 수 있는 빌드 오브젝트도 포함합니다. 성공한 [iOS 워크플로 실행](https://github.com/hanfdev/mihonban/actions/workflows/mobile.yml)에서 아티팩트를 받을 수 있으며 보존 설정에 따라 만료됩니다. App Store에 자동으로 출시하지 않습니다.

## 테스트

Xcode 테스트 scheme을 실행하기 전에 다른 터미널에서 픽스처 서버를 시작하세요.

```sh
python3 -I ios/tools/fixture-server.py ios/TestFixtures
```

서버는 루프백 포트 8766에서 합성 미디어와 API 픽스처를 제공합니다. 테스트 범위는 API 계약, 오프라인 시작, 라이브러리 새로 고침, 즐겨찾기, 대기열 전환, 캐시/다운로드 처리, 디코딩/탐색, 글꼴 표시, 레이아웃, 네이티브 탐색입니다. CI는 iPhone 테스트 모음과 별도 iPad 부분 집합을 실행하고 보고서와 스크린샷을 업로드합니다. 선정한 문서용 스크린샷은 `docs/images/`에 커밋하며 전체 스크린샷과 테스트 보고서는 버전 관리 밖의 생성물로 유지합니다. 운영 계정이나 음악 컬렉션은 필요하지 않습니다. iOS 빌드 또는 시뮬레이터 실행에는 macOS가 필요하며, 이식 가능한 Python 검사만 통과해서는 Swift 컴파일이나 기기 동작을 검증할 수 없습니다.

## 생성 리소스 유지 관리

공유 Web 번역이나 검색 별칭을 수정한 후 커밋된 카탈로그를 다시 생성하고 차이를 검토하세요.

```sh
node ios/tools/export-locales.mjs
node ios/tools/export-search.mjs
python3 -I ios/tools/check-l10n.py
python3 -I ios/tools/check-fonts.py
```

이미지나 글꼴 지원 범위를 변경할 때만 개발용 Python 환경에 Pillow, fontTools, Brotli를 설치하고 `python3 ios/tools/prepare-assets.py .`를 실행하세요. 고정된 원본과 공유 Web 자산에서 아이콘/로고와 대체 글꼴을 다시 생성하며, 일반 빌드에는 필요하지 않습니다.

프로젝트는 AGPL-3.0-only를 사용합니다. 포함된 글꼴에는 각각의 SIL Open Font License가 유지됩니다. SFBAudioEngine과 코덱 의존성에는 각 라이선스가 유지되므로 빌드를 배포할 때 생성된 고지와 의존성 정보를 보존하세요.

[프로젝트 문서로 돌아가기](../README.ko.md)
