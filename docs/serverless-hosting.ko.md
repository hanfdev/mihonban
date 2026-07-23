# Cloudflare 서버리스 호스팅

[English](serverless-hosting.md) · [简体中文](serverless-hosting.zh.md) · [繁體中文](serverless-hosting.zh-Hant.md) · [日本語](serverless-hosting.ja.md) · [한국어](serverless-hosting.ko.md) · [Français](serverless-hosting.fr.md) · [Español](serverless-hosting.es.md)

serverless 목표는 집에서 컴퓨터가 꺼져 있을 때도 로그인, 탐색, 재생을 계속 온라인으로 유지하는 것입니다. 지원되는 형태는 React 앱과 API를 제공하는 Worker, D1 + KV, 이미지 선택적 R2, OneDrive, WebDAV, Google Drive에 저장된 오디오를 제공합니다.

## 적합한 워크로드

| 일 | Cloudflare Workers 적합 |
|---|---|
| React 자산과 짧은 API 요청 | 좋습니다 |
| D1 카탈로그/설정과 KV 짧은 캐시 | 좋아요 |
| RSS/Atom/Blogger 소스 알림 | Cron Trigger 잘 사용해 주세요 |
| 저장소에서 스트리밍 Range | 네트워크 및 요금제 제한에 따라 지원 |
| 받은 편지함 감시, 아카이브 추출, 비트, 대량 태그 편집 | 지원되지 않음; 로컬 동반자 |
| 트랜스코딩 또는 영구 로컬 폴더 스캔 | 지원되지 않음; Node/NAS 도구 사용 |

## 권장 구성

```text
Browser
  |
Cloudflare Worker (API + React assets)
  |-- D1: catalog and settings
  |-- KV: rate limits and short-lived cache
  |-- optional R2: image mirror
  +-- OneDrive / WebDAV / Google Drive: audio and originals
```

[설치 및 배포](install.ko.md)를 따르세요. 로컬 카탈로그를 옮기기 전에 [데이터베이스 마이그레이션](database-migration.ko.md)을 진행해야 합니다. 관리자 설정만 가져와서는 앨범이 복원되지 않습니다.

## 집 컴퓨터는 켜져 있어야 하나요?

아니요, 웹 로그인, 브라우징, 재생, 웹 가져오기, 또는 예약된 소스 스캔에는 사용하지 않습니다. 로컬 인박스 처리, 로컬/클라우드 조정, 오프라인 백업 또는 기타 관련 작업에만 이 기능을 켜세요.

Cloudflare Workers 홈 디렉터리를 볼 수 없거나 파일 시스템 이벤트를 기다릴 수 없습니다. 받은 편지함을 지속적으로 실행하려면 Python 동반자를 항상 연결된 NAS나 저전력 호스트에 배치하세요. 그 장치는 파일을 정리하고 동기화합니다; 웹 앱은 여전히 독립적으로 실행됩니다Cloudflare.

## 무료가 무한을 의미하지는 않아

Workers, D1, KV, R2 할당량과 가격이 변경될 수 있습니다; 현재 Cloudflare 대시보드와 공식 문서를 권한으로 사용하세요. 프로젝트의 무료 계층 전제는 개인 라이브러리나 소수의 청취자이며, 대규모 공개 배포나 연속 테라바이트 규모의 무손실 오디오 중계가 아닙니다.

임시 URL OneDrive 일반적으로 Worker를 우회합니다. WebDAV, Google Drive, 그리고 명시적으로 활성화된 오디오 프록시 전송 바이트는 Worker를 통해 전송되며 더 많은 플랫폼 자원을 소비합니다.

## 외부 오디오 프록시

먼저 메인 배포를 테스트하세요. 다른 Worker 경로나 사용자 지정 도메인이 경로를 개선한다는 측정 결과가 있을 때만 별도 프록시를 추가하세요. 이 프록시는 서명과 허용 목록을 사용하는 릴레이이지 공개 CDN이 아니며, 더 빠른 속도를 보장하지 않습니다. [선택적 Cloudflare 오디오 프록시](audio-proxy.ko.md)를 참고하세요.

## 공개 전 체크리스트

- HTTPS를 통해 Worker URL/커스텀 도메인을 엽니다.
- 청취자, 관리자, 그리고 선택적으로 비밀번호 없는 게스트 권한이 정확합니다.
- 데스크톱, iOS Safari, Android Chrome에서 재생 및 작업 요청
- 숨겨진 콘텐츠는 API 수준에서 리스너에게 제공되지 않습니다.
- 모든 이름 있는 스토리지 백엔드가 테스트됩니다; 하나의 쓰기 대상이 선택됩니다.
- 선택적 R2 이미지와 프록시는 독립적으로 테스트됩니다.
- D1 SQL, 관리자 설정 JSON, runtime 비밀, 오디오 백업 등이 모두 포함됩니다.
- Git, 문서, 로그, 스크린샷에 비밀이 나타나지 않음.
