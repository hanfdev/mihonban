# Mihonban RYM 브라우저 도구

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

RYM 발매 메타데이터를 기존 Mihonban 라이브러리에 보내는 선택적 Chrome/Edge Manifest V3 확장 프로그램입니다. 1.1.0은 사용자가 직접 시작하는 큐로 기존 소스 링크가 있는 앨범의 평점과 평가 수를 갱신합니다.

## 빌드 및 설치

저장소 루트에서 Web 의존성을 설치하고 빌드합니다.

```sh
npm --prefix cloud/web ci
npm --prefix cloud/web run build
```

빌드는 확장과 공유 파서를 `cloud/web/dist/rym-browser-tool/`로 복사하고 `cloud/web/dist/rym-browser-tool.zip`을 생성합니다. Chrome/Edge 확장 페이지의 압축해제된 확장 프로그램 로드(Load unpacked)로 `manifest.json`이 있는 생성 폴더를 선택하세요. 소스 디렉터리만으로는 부족하며 빌드가 `rym-capture.js`와 `batch-reader.js`를 제공합니다. 설치본을 교체하면 확장 페이지에서 새로고침(Reload)을 누르세요.

배포 서버의 Admin → RYM updates → Batch update ratings에서 같은 ZIP을 제공합니다. 설치, 소스 일치, 분류 검토는 [사용 설명서](../../docs/manual.ko.md#rym-메타데이터)를 보세요.

## 동작 모드

- **현재 페이지 보내기:** RYM 발매 페이지를 새로고침하고 확장을 열어 Mihonban 주소를 설정한 뒤 보냅니다. Mihonban에서 일치하는 앨범을 확인하세요. 분류는 제안으로 들어오며 명시적으로 채택해야 합니다.
- **평점 일괄 갱신:** 관리자로 Mihonban을 열고 해당 탭에서 확장을 실행하여 연결된 앨범을 선택한 뒤 큐를 시작합니다. 평점과 평가 수만 갱신하고 같은 소스의 여러 판본은 한 번의 관측을 공유하며 수동 분류와 순위는 유지합니다.

라이브러리와 큐 탭을 열어 두세요. 탐색 간격은 최소 30초입니다. 인증 확인이나 요청 제한 시 큐가 멈춥니다. 소스 탭에서 확인을 마친 뒤 명시적으로 재개해야 합니다. 요청 제한 후 최소 5분을 기다립니다. 일시 정지/재개와 재시도를 지원하지만 예약 백그라운드 서비스를 실행하거나 사이트 확인을 우회하지 않습니다.

일괄 모드를 시작할 때 선택적 RYM 접근 권한을 요청합니다. 열린 라이브러리 탭의 기존 관리자 세션을 사용하며 암호, 쿠키, 전체 HTML은 저장하지 않습니다. 라이브러리 주소, 큐 진행 상황, 수집 평점은 기기에 저장하고 새 배치를 선택하면 이전 작업을 바꿉니다.

## 검사

```sh
node --test cloud/web/test/rym-capture.test.js cloud/web/test/rym-batch.test.js
```

`cloud/worker/test/rym-updates.test.js`의 Worker 테스트는 소스 일치, 동시 편집, 관측 최신성, 수동 분류, 평점 전용 갱신 엔드포인트를 다룹니다.
