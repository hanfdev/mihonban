# 네이티브 클라이언트 호환성 계약

[English](API_COMPATIBILITY.md) · [简体中文](API_COMPATIBILITY.zh.md) · [繁體中文](API_COMPATIBILITY.zh-Hant.md) · [日本語](API_COMPATIBILITY.ja.md) · [한국어](API_COMPATIBILITY.ko.md) · [Français](API_COMPATIBILITY.fr.md) · [Español](API_COMPATIBILITY.es.md)

네이티브 클라이언트는 `cloud/web`과 별개입니다. 다음 API 동작이 호환성을 유지하면 Mihonban 서버는 웹 화면을 변경하고 독립적으로 배포할 수 있습니다.

## 세션과 라이브러리

클라이언트는 요청 사이에 세션 쿠키를 유지합니다. 설정된 게스트 세션은 비밀번호 없이 탐색할 수 있고 보호된 배포는 로그인이 필요합니다. 숨긴 앨범 및 공유 즐겨찾기 변경에는 서버 권한이 적용됩니다.

- `GET /api/health`는 성공 응답을 반환합니다.
- `GET /api/me`는 현재 세션 객체를 반환합니다. `401`이면 클라이언트가 비밀번호 입력 절차를 표시해야 합니다.
- `POST /api/login`은 `{ "password": "..." }`를 받아 `{ "ok": true, "role": "user|admin" }`를 반환합니다.
- `GET /api/library`는 볼 수 있는 앨범 배열을 반환합니다.
- `GET /api/tracks`는 볼 수 있는 트랙 배열을 반환합니다.
- `GET /api/album/:id`는 `tracks` 배열을 포함한 앨범 객체를 반환합니다.
- `GET /api/artists`는 아티스트 메타데이터를 반환합니다.
- `GET /api/favorites`는 `albums`와 `tracks` 배열을 포함한 객체를 반환하며 각 항목에는 `id`가 있습니다.
- `PUT /api/favorites/:kind/:id`는 공유 즐겨찾기를 추가하고 같은 경로의 `DELETE`는 제거합니다. `kind`는 `album` 또는 `track`이며 쓰기는 관리자 권한이 필요합니다.

권한이 있는 관리자는 앨범 및 트랙 목록에 `?hidden=1`을 사용할 수 있습니다. 앨범 상세에는 `note`, `images`, `similar`도 포함될 수 있습니다. 요청 경로의 아티스트 이름과 항목 ID는 URL 인코딩합니다.

## 이미지와 오디오

- `GET /api/art/:albumId?s=480`은 이미지 본문을 반환합니다.
- `GET /api/image/:id?s=:size`는 앨범 갤러리 이미지를 반환합니다.
- `GET /api/artist-bio/:name`은 `bio` 문자열을 포함한 객체를 반환합니다.
- `GET /api/artist-art/:name`은 아티스트 이미지를 반환하며 사용자 지정 사진이면 `?v=c`를 붙입니다.
- `GET /api/stream/:trackId`는 원본 오디오 바이트 또는 해당 오디오로 이어지는 성공적인 리디렉션을 반환합니다.

데스크톱 클라이언트는 완전한 오디오 파일을 다운로드하여 로컬에서 디코딩하고 탐색하며 Web 플레이어의 스트리밍 배치에 의존하지 않습니다. 이미지 다운로드는 응답당 32 MiB로 제한됩니다. 정확한 요청 경로와 역직렬화 기본값은 [`src/api.rs`](src/api.rs)를 참고하세요.

## 호환성과 클라이언트 업데이트

클라이언트는 알 수 없는 JSON 필드를 무시하고 모델에서 선택적으로 정의한 필드에는 기본값을 제공합니다. 앨범 ID, 아티스트 이름, 제목 같은 필수 필드는 호환되는 형식을 유지해야 합니다. 알 수 없는 필드를 추가할 수 있다고 해서 기존 필수 필드를 생략할 수 있는 것은 아닙니다. 클라이언트는 Mihonban 데이터베이스, 저장소 자격 증명 또는 배포 파일에 접근하지 않으므로 이 API 계약 내에서 서버 이전, 저장소 백엔드 및 클라이언트 릴리스를 독립적으로 변경할 수 있습니다.

클라이언트 릴리스는 `latest`, `download_url`, `sha256`, `notes`가 들어 있는 별도 호스팅 JSON 매니페스트를 사용할 수 있습니다. SHA-256 체크섬을 제공하세요. 현재 클라이언트는 해당 필드가 비어 있지 않을 때만 검사합니다. 다운로드는 실행 파일을 수동으로 교체하도록 준비하며 자동 설치나 서버 업데이트를 수행하지 않습니다. 설정, 빌드 및 재생은 [데스크톱 안내](README.ko.md)를 참고하세요.
