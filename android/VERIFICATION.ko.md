# Android 검증 기록

[English](VERIFICATION.md) · [简体中文](VERIFICATION.zh.md) · [繁體中文](VERIFICATION.zh-Hant.md) · [日本語](VERIFICATION.ja.md) · [한국어](VERIFICATION.ko.md) · [Français](VERIFICATION.fr.md) · [Español](VERIFICATION.es.md)

현재 소스 버전은 0.1.10 / 버전 코드 11입니다. 도구 체인은 JDK 17, Gradle 8.9, Android Gradle Plugin 8.7.3, Kotlin 2.0.21, SDK 35, Build Tools 35.0.0입니다.

## 재현 방법

설치된 SDK를 `ANDROID_HOME` 또는 무시되는 `android/local.properties`로 지정한 뒤 저장소 루트에서 실행합니다.

```powershell
android\gradlew.bat -p android testDebugUnitTest lintDebug assembleDebug assembleRelease
android\gradlew.bat -p android connectedDebugAndroidTest
```

macOS/Linux에서는 같은 작업과 함께 `sh android/gradlew -p android`를 사용하세요. 래퍼는 Gradle 8.9를 고정하고 체크섬을 확인합니다. 두 번째 명령은 에뮬레이터나 기기가 필요합니다. 테스트에는 내장 HTTP 픽스처와 합성 음원을 사용하며 운영 서버, 자격 증명, 개인 음악이 필요 없습니다.

표준 출력은 `android/app/build/` 아래에 있습니다.

- `reports/tests/testDebugUnitTest/`, `test-results/testDebugUnitTest/`: JVM 보고서.
- `reports/lint-results-debug.html`, `.xml`: lint 진단.
- `reports/androidTests/`, `outputs/androidTest-results/`: 기기 보고서.
- `outputs/apk/debug/app-debug.apk`: 개발 APK.
- `outputs/apk/release/app-release-unsigned.apk`: 릴리스 서명이 필요한 축소 APK.

[Android 워크플로](../.github/workflows/android.yml)는 Debug/Release 빌드, JVM 테스트, lint 및 별도 API 35 에뮬레이터 작업을 실행하고 APK, 보고서, 스크린샷을 CI 산출물로 올립니다. 선택된 문서 이미지는 `docs/images/`에 커밋되며 전체 생성 출력과 로컬 검증 자료는 버전 관리에서 제외됩니다.

## 기록된 결과

2026-11-07 소스 공개 검사는 Gradle 8.9와 JDK 17로 `testDebugUnitTest lintDebug assembleDebug assembleRelease`를 성공적으로 마쳤습니다. 기존 증분 출력을 재사용하여 작업 2개를 실행했고 97개는 최신 상태였습니다. 로컬 네트워크 검사에서 래퍼 배포본 다운로드가 완료되지 않아 이미 설치된 Gradle 8.9를 사용했습니다. 로컬 초기화 스크립트로 기존 빌드 출력 디렉터리를 선택했으며 소스와 작업은 이 저장소의 것입니다.

재사용한 보고서에는 JVM 테스트 29개가 있으며 실패, 오류, 건너뜀은 없습니다. lint 오류 0개, 경고 15개, 정보 1개입니다. 개발 APK와 축소된 미서명 release APK가 존재합니다. 이는 증분 검증 결과이며 새 에뮬레이터 실행이나 독립적인 클린 빌드가 아닙니다.

이전 2026-11-05 검증은 Android 15 / API 35 x86_64 에뮬레이터(945 × 1680 픽셀, 420 dpi)에서 기기 테스트 22개가 모두 통과했고 개발 APK 서명도 확인했습니다. 네이티브 탐색, 재생/탐색 위치, 큐, 다운로드/오프라인, 캐시 분리, 다음 곡 미리 읽기, 접히는 도구 모음 회귀를 다룹니다.

도구 모음 회귀 검사는 부분 접힘, 여러 화면 밀도/글꼴 배율, 상태 표시줄 여백을 표본으로 삼은 뒤 완전 접힘, 복원, 밀도 변경을 검증합니다. 0.1.10에서 수정한 제목/아이콘 조각 문제를 대상으로 합니다. 기존 lint 항목은 의존성 업데이트, 동기식 설정 저장, 내보낸 미디어 서비스, 앱 범위 저장소 참조, 가져오기 UI의 박싱된 정수 상태에 관한 것입니다.

## 검증 범위 제한

2026-11-07 문서 업데이트를 위해 새 에뮬레이터나 실제 기기 실행을 수행하지 않았습니다. Android 8 실행, Android 16 및 제조사별 동작, 배터리/헤드셋 통합, 운영 저장소 계정 통합은 아직 검증하지 않았습니다. Android 15에서 큐를 즉시 지우고 다시 시작한 뒤 늦은 Stop이 도착하는 경합도 알려진 제한입니다.

코덱, 전경 업로드, 고급 서버 관리 제한은 [Android 안내](README.ko.md#현재-제한)를 보세요. CI와 로컬 APK의 서명/체크섬은 다를 수 있으므로 실제 설치하려는 실행의 산출물을 확인하세요.
