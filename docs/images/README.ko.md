# 문서용 스크린샷

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

실제 Mihonban 화면에 가상의 앨범, 아티스트, 평점과 소개를 넣어 촬영했습니다. Web과 Android는 직접 만든 기하학적 표지를, iOS는 앱에 내장된 레코드 기본 이미지를 사용합니다. 개인 컬렉션이나 상업용 앨범 표지는 포함하지 않습니다. Web, 네이티브 Android, 네이티브 iOS는 서로 다른 클라이언트이며, 이미지는 디자인 목업이 아닙니다.

## 이미지 목록

| 이미지 | 화면 | 촬영 날짜 | 소스 버전 |
|---|---|---|---|
| [web-library.webp](web-library.webp) | Web 앨범 라이브러리, 영어 | 2026-11-08 | Web 소스 `351ba8e` |
| [web-library-zh.webp](web-library-zh.webp) | Web 앨범 라이브러리, 중국어 간체 | 2026-11-08 | Web 소스 `351ba8e` |
| [web-album.webp](web-album.webp) | Web 앨범 상세, 영어 | 2026-11-08 | Web 소스 `351ba8e` |
| [android-library.webp](android-library.webp) | 네이티브 Android 앨범 라이브러리 | 2026-11-05 | Android 0.1.10 |
| [android-player.webp](android-player.webp) | 네이티브 Android 플레이어 | 2026-11-05 | Android 0.1.8 |
| [ios-library.webp](ios-library.webp) | 네이티브 iPhone 앨범 라이브러리 | 2026-11-07 | iOS 0.2.0, `5e667fb`, CI #72 |
| [ios-album.webp](ios-album.webp) | 네이티브 iPhone 앨범 상세 | 2026-11-07 | iOS 0.2.0, `5e667fb`, CI #72 |
| [ios-player.webp](ios-player.webp) | 네이티브 iPhone 플레이어 | 2026-11-07 | iOS 0.2.0, `5e667fb`, CI #72 |
| [ios-ipad-album.webp](ios-ipad-album.webp) | 네이티브 iPad 앨범 상세, 가로 화면 | 2026-11-07 | iOS 0.2.0, `5e667fb`, CI #72 |

Web 이미지는 촬영 당시의 1280 × 720 크기를 유지합니다. Android와 iPhone은 비율을 유지하며 800 × 1440 이내로 축소했고, iPad는 기록된 EXIF 방향을 적용한 후 1600 × 1200으로 축소했습니다. 모두 WebP 압축(품질 88)을 사용하며 화면 요소를 자르거나 재배치하지 않았습니다. 원본 해상도 이미지와 기타 테스트 결과물은 버전 관리 밖에 보관합니다.

## Web 데모 재현

Node.js 20 이상으로 저장소 루트에서 실행하세요.

```bash
npm --prefix cloud/web ci
npm --prefix cloud/web run build
node tools/docs-demo.mjs --check
node tools/docs-demo.mjs
```

라이브러리는 <http://127.0.0.1:8767>, 대표 앨범은 <http://127.0.0.1:8767/#/album/midnight-sessions>에서 엽니다. 언어 메뉴에서 English 또는 简体中文을 선택하세요. 문서 이미지는 어두운 테마와 기본 평점 정렬을 사용합니다. `Ctrl+C`로 서버를 중지하세요. 기본 포트가 사용 중이면 `MIHONBAN_DEMO_PORT`를 설정하세요.

[`tools/docs-demo.mjs`](../../tools/docs-demo.mjs)는 현재 빌드된 React 앱에 가상의 앨범 18개, 곡 144개, 아티스트 6명을 제공합니다. 루프백에서만 수신하고 읽기 요청만 허용하며, 데이터베이스, 자격 증명, 저장소 제공자, 운영 서비스에 접근하지 않습니다. 재생은 Range 요청을 지원하는 생성된 무음 WAV 오디오를 사용합니다. Google Fonts를 요청하는 대신 저장소의 Inter 및 Shippori Mincho 글꼴을 로컬에서 제공합니다. 앱 컴포넌트와 레이아웃 스타일은 변경하지 않습니다.

이미지를 갱신하려면 현재 빌드의 해당 페이지를 촬영하고 확인한 후 WebP로 변환하고 위 표의 날짜와 소스 버전을 갱신하세요. 이미지를 다시 사용할 때도 앨범명과 평점이 가상 데이터임을 명시하세요.

## Android 출처

Android 예시는 [`NativeUiTest.kt`](../../android/app/src/androidTest/java/org/mihonban/android/NativeUiTest.kt)의 네이티브 UI 픽스처에서 가져왔습니다. 가상 카탈로그 데이터를 제공하고 Android Canvas로 자체 표지를 그립니다. 선택된 로컬 원본은 `android/build/screenshots/0110-08-library-overview.png` 및 `android/build/screenshots/018-player-tall.png`입니다. 위에 명시한 버전의 대표 이미지이며, 모든 클라이언트 또는 현재 화면을 동시에 다시 촬영했다는 의미는 아닙니다.

빌드와 계측 테스트 방법은 [Android 개발 가이드](../../android/README.ko.md)를 참고하세요. 이 디렉터리의 선정된 압축 문서 이미지만 커밋하며, 전체 테스트 결과는 무시되는 Android 빌드 디렉터리에 남겨 둡니다.

## iOS 출처

네이티브 iOS 이미지는 성공한 [iOS 미리보기 실행 #72](https://github.com/hanfdev/mihonban/actions/runs/42380336181)의 소스 커밋 [`5e667fb`](https://github.com/hanfdev/mihonban/commit/5e667fbacfb99ab3020ae8869f4534ed7f917dc4)에서 가져왔습니다. 2026-11-07에 Xcode UI 테스트가 **iPhone 17** 및 **iPad Pro 13-inch (M5)** 시뮬레이터에서 영어 인터페이스와 어두운 모드로 촬영했습니다. 실제 기기 사진이 아니라 시뮬레이터 캡처입니다. 선정된 이미지는 [`DemoLibrary.swift`](../../ios/Sources/DemoLibrary.swift)의 가상 카탈로그와 [`Theme.swift`](../../ios/Sources/UI/Theme.swift)의 내장 레코드 기본 이미지를 표시합니다.

| 문서 이미지 | 첨부 이름 | `MihonbanUITests`의 테스트 |
|---|---|---|
| `ios-library.webp` | `01-library` | `testBrowsePlayPauseAndQueue` |
| `ios-album.webp` | `02-album` | `testBrowsePlayPauseAndQueue` |
| `ios-player.webp` | `03-now-playing` | `testBrowsePlayPauseAndQueue` |
| `ios-ipad-album.webp` | `48-album-balanced-landscape` | `testTabletAlbumHeaderBalancesArtworkAndInformation` |

다운로드한 `iOS-screenshots-72` 압축 파일을 GitHub 실행 페이지의 SHA-256 해시 `34f1bb830c6453fe2074c77744ff23a34461b0fb32fb57688636e2542fae8457`와 대조했습니다. 첨부 매니페스트는 각 테스트, 기기, 타임스탬프와 원본 파일명을 기록하며 iPad 첨부는 `ipad/`에 있습니다. 선택된 첨부 중 테스트 실패와 연결된 것은 없습니다.

이미지를 갱신하려면 macOS에서 [iOS 개발 가이드](../../ios/README.ko.md)를 따라 [`MihonbanUITests.swift`](../../ios/UITests/MihonbanUITests.swift)의 해당 테스트를 실행하고 `xcrun xcresulttool export attachments`로 결과 번들의 첨부를 내보내세요. [iOS 워크플로](../../.github/workflows/mobile.yml)는 이미 이 작업을 수행하고 `iOS-screenshots-<run_number>` 아티팩트를 게시합니다. 위에 명시된 첨부를 선택하고 이미지에 기록된 방향을 적용한 뒤 비율을 유지하며 축소하고 촬영/버전 표를 갱신하세요. CI 아티팩트는 보존 기간이 지나면 만료되지만 선정된 WebP 이미지는 저장소에 남습니다.

[프로젝트 문서로 돌아가기](../../README.ko.md)
