# 선택적 Cloudflare 오디오 프록시

[English](audio-proxy.md) · [简体中文](audio-proxy.zh.md) · [繁體中文](audio-proxy.zh-Hant.md) · [日本語](audio-proxy.ja.md) · [한국어](audio-proxy.ko.md) · [Français](audio-proxy.fr.md) · [Español](audio-proxy.es.md)

`cloud/proxy-worker`는 메인 mihonban 앱의 임시 오디오 URL을 중계하는 독립 실행형 Worker입니다. 두 번째 Worker 경로나 커스텀 도메인이 스토리지 CDN으로 더 나은 경로를 제공할 때 유용합니다.

오디오 캐시가 없고 더 빠른 속도를 보장할 수 없습니다. 전후로 측정하세요.

## 보안 모델

- 메인 Worker 소스 URL과 5분 만료 서명을 `STREAM_PROXY_SECRET`.
- 프록시는 `PROXY_SECRET`와 동일한 값을 검증합니다.
- GET, HEAD, OPTIONS만 허용됩니다.
- `ALLOWED_HOSTS` 내 HTTPS 업스트림만 허용됩니다.
- 모든 상류 리디렉션은 허용 목록과 대조됩니다.
- Range 및 조건부 헤더는 전달됩니다; 쿠키와 권한 부여 헤더는 전달되지 않습니다.
- 응답은 비공개/스토어 없음입니다.

프로덕션에서 서명 없는 모드를 활성화하지 말고, 제한 없는 호스트 와일드카드를 설정하지 마세요.

## 1. 프록시를 구성 및 배포하세요

수정 `cloud/proxy-worker/wrangler.jsonc`:

- `ALLOWED_HOSTS`: 점으로 시작하는 쉼표 구분된 정확한 호스트 또는 접미사.
- `ALLOWED_ORIGINS`: 주요 mihonban 기원; `*` 작동하지만 구체적인 기원이 더 좋습니다.

기본 OneDrive 접미사는 출발점입니다. 마이크로소프트는 테넌트 또는 지역 다운로드 도메인으로 리디렉션할 수 있습니다; 실패한 요청에서 관찰된 정확한 접미사만 추가하세요.

```bash
cd cloud/proxy-worker
npm ci
npm test
npx wrangler login
npx wrangler secret put PROXY_SECRET
npx wrangler deploy
```

최소 32개의 랜덤 문자를 사용하세요; 32개의 랜덤 바이트로 생성된 16진 문자열을 권장합니다. 동일한 값을 메인 Worker에 추가할 수 있도록 임시로 유지하세요.

## 2. 메인 Worker 설정

```bash
cd ../worker
npx wrangler secret put STREAM_PROXY_SECRET
npx wrangler deploy
```

`PROXY_SECRET`에 사용된 똑같은 비밀을 붙여넣으세요.

mihonban 관리자 모듈 패널에서:

1. 오디오 프록시 활성화.
2. 맞춤 프록시 URL 설정:

```text
https://mihonban-audio-proxy.<account>.workers.dev/?url={url}
```

3. OneDrive 백킹 트랙을 저장하고 재생합니다.

메인 Worker 자동으로 `expires`와 `sig`을 추가합니다. 공유 비밀을 URL에 절대 넣지 마세요.

## 3. 검증

```bash
curl https://mihonban-audio-proxy.<account>.workers.dev/healthz
```

그 다음 플레이할 때 브라우저 네트워크 도구를 사용하세요:

- 메인 `/api/stream/<id>`가 프록시로 302를 반환합니다.
- 프록시는 200 또는 206을 반환합니다.
- 탐색은 `Range`을 보내고 `Content-Range`을 받는다.
- 서명되지 않은 `?url=...` 요청은 401을 반환합니다.
- 허용되지 않은 호스트는 403을 반환합니다.

## 범위

외부 프록시는 메인 Worker가 임시 다운로드 URL을 얻을 수 있을 때만 사용되며, 현재는 OneDrive 스타일 백엔드입니다. WebDAV, Google Drive, Node 로컬 저장소는 개인 자격 증명을 요구하며 메인 Worker 뒤에 머무릅니다.

## 문제 해결

| 상태 | 의미/행동 |
|---|---|
| 401 | 비밀이 다르거나, 서명이 만료되었거나, 주 Worker가 재배치되지 않았다 |
| 403 | 초기 소스 호스트는 허용되지 않음 |
| 호스트 메시지 포함 502 | 리디렉션이 다른 호스트에게 도달했습니다; 접미사를 추가하기 전에 검토 |
| 416 | 상류가 요청한 바이트 범위를 거부함 |
| 재생 속도가 느려집니다 | 외부 URL을 비활성화하고 직Worker 경로를 사용하세요 |

서명 값이 노출되면 두 비밀을 함께 순환시키세요. 기존 서명된 URL은 5분 이내에 만료됩니다.
