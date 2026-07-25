# 아키텍처와 런타임 모델

[English](cloud.md) · [简体中文](cloud.zh.md) · [繁體中文](cloud.zh-Hant.md) · [日本語](cloud.ja.md) · [한국어](cloud.ko.md) · [Français](cloud.fr.md) · [Español](cloud.es.md)

Mihonban은 로컬과 클라우드 배포에서 동일한 React 프론트엔드와 Worker 호환 API를 사용합니다. 영속성 및 파일 접근 어댑터만 실행 환경에 따라 달라집니다.

## 구성 요소

| 구성 요소 | Node | 로컬 Wrangler | Cloudflare | 데이터의 성격 |
|---|---:|---:|---:|---|
| React 에셋 | 예 | 예 | 예 | 재구성 가능 |
| Hono API | 예 | 예 | 예 | 상태 없는 애플리케이션 계층 |
| 카탈로그 데이터베이스 | SQLite | 로컬 D1 | 원격 D1 | 원본 메타데이터 |
| 속도 제한/캐시 KV | SQLite 어댑터 | 로컬 KV | Cloudflare KV | 재구축 가능 |
| R2 이미지 미러 | 선택 사항 | 선택적 바인딩 | 선택 사항 | 재구성 가능한 이미지 캐시 |
| 로컬 폴더 백엔드 | 예 | 아니요 | 아니요 | 구성된 경우 원본 파일 |
| OneDrive／WebDAV／Google Drive | 예 | 예 | 예 | 원본 파일 |
| Python 컴패니언 | 외부 프로세스 | 외부 프로세스 | 외부 프로세스 | 선택적 로컬 워크플로우 |

오디오 파일은 D1, KV, R2 이미지 캐시, 또는 Git에 절대 속하지 않습니다.

## 요청 경로

```text
Browser --HTTP/HTTPS--> API runtime
                         |-- catalog metadata: SQLite or D1
                         |-- short cache/rate limit: KV adapter
                         |-- image mirror: optional R2
                         +-- named storage backend

OneDrive temporary URL ---------> usually 302 direct playback
WebDAV / Google Drive ----------> main API Range proxy
Node local folder --------------> Node Range stream
Optional external proxy --------> signed five-minute relay for temporary URLs
```

외부 프록시는 메인 API가 임시 URL을 얻을 수 있는 소스만 받습니다. WebDAV, Google Drive, 로컬 폴더 자격 증명은 절대 받지 않습니다.

## 인증과 역할

- 청취자 비밀번호(초기값 `APP_PASSWORD`): 탐색과 재생.
- 관리자 비밀번호(초기값 `ADMIN_PASSWORD`): 모든 쓰기 작업과 인프라 설정.
- 비밀번호 없는 게스트 모드: 관리 화면에서 명시적으로 켜면 비밀번호 없이 청취자 권한을 부여합니다.
- 컴패니언 키(`COMPANION_KEY`): 로컬 Python 컴패니언이 사용하는 선택적 `X-Api-Key`.

관리자에서 변경된 비밀번호는 PBKDF2 해시로 저장되며 부트스트랩 환경 값보다 우선합니다. 비밀번호를 변경하면 세션 에포크가 증가하고 기존 로그인 쿠키가 취소됩니다. 로그인 실패는 소스 IP별로 집계되며; 6번의 실패 시 해당 소스가 15분간 잠깁니다.

프로덕션 쿠키는 HTTPS를 필요로 합니다. `DEV_INSECURE_COOKIE=1` 신뢰할 수 있는 로컬 HTTP 테스트에만 사용됩니다.

## 데이터 모델

- `albums`: 앨범 메타데이터, 명명된 `storage_id`, 숨겨진 상태, 정렬 필드.
- `tracks`: 트랙 메타데이터와 저장 상대 경로; 트랙은 앨범 백엔드를 계승합니다.
- `artists`: 아티스트 메타데이터, 숨겨진 상태, 아바타 경로, 독립 아바타 `storage_id`.
- `album_images`: 앨범 백엔드의 갤러리 경로.
- `favorites`: 앨범/트랙 인기 곡 및 순서.
- `notes`: 앨범 노트, 아티스트 노트, 약력.
- `storages`: 명명된 OneDrive, WebDAV, Google Drive 또는 Node 로컬 구성.
- `settings`: 비밀번호 해시, 모듈 플래그, R2 구성, 소스 설정 및 기타 runtime 상태.
- `source_posts`, `track_imports`, 이미지 캐시 테이블: 운영 메타데이터.

관리자 설정 JSON은 허용 목록에 포함된 설정 하위 집합과 이름 있는 저장소 구성, 자격 증명 등을 내보냅니다. 카탈로그 행, 비밀번호 해시, 오래된 세션은 제외합니다. 암호화된 상태로 저장하세요.

## 업로드 및 재생

- 새로운 업로드를 위한 쓰기 대상으로 단일 이름이 지정된 백엔드가 선택됩니다.
- 기존 앨범은 자체 `storage_id`을 유지한다; 쓰기 목표를 변경해도 앨범은 이동하지 않는다.
- OneDrive 업로드 세션과 임시 다운로드 URL을 사용합니다.
- WebDAV 및 Google Drive 업로드/스트림은 메인 API를 통과합니다.
- Node 로컬 폴더 파일은 Node runtime에서만 스트리밍됩니다.
- 신뢰할 수 있는 탐색을 위해서는 특히 iOS에서 Range 및 `Content-Range` 동작이 필요합니다.

## 이미지

R2를 사용하지 않으면 API는 이미지를 소유한 저장소에서 읽고 엣지／브라우저 캐시 헤더를 적용합니다. R2를 활성화하면 첫 요청이나 예열 과정에서 이미지를 미러로 복사하고, 이후 요청을 공개 URL로 리디렉션할 수 있습니다. 이미지를 교체하면 인덱스가 무효화되어 다시 미러링할 수 있습니다. D1 인덱스가 사라졌더라도 같은 공개 R2 객체가 남아 있으면, 예열 작업은 횟수가 제한된 HEAD 요청으로 객체를 다시 등록하며 이미지 데이터를 다시 다운로드하거나 업로드하지 않습니다.

공개 R2 이미지 리디렉션은 브라우저와 Cloudflare 엣지에서 5분 동안 캐시되며 stale-while-revalidate가 활성화됩니다. 리디렉션 대상은 버전이 붙은 불변 R2 URL이므로 라이브러리를 새로 고칠 때 커버마다 Worker를 다시 호출하지 않습니다. 커버를 교체해도 캐시 시간이 지나면 반영됩니다. 숨김 이미지와 오디오 리디렉션은 계속 비공개 및 캐시 없음으로 유지됩니다.

앨범 커버는 저장된 원본 파일을 직접 읽습니다. 수동 또는 Discogs에서 자른 커버는 공급자의 `c480x480`과 `c1000x1000` 썸네일이 서로 다른 초점을 선택하고 세로 원본을 다시 자를 수 있으므로 특히 중요합니다. 따라서 모든 커버 화면은 `art:<album-id>:original` 미러를 공유하며 브라우저가 동일한 정사각형 구성을 축소합니다.

공개 미러 리디렉션이 누락되었거나 오래된 객체를 가리키면 웹 앱은 원본 저장소에서 다시 읽습니다. Worker는 반환된 이미지 바이트를 검증하고, 필요하면 공급자 썸네일 대신 원본 파일을 사용합니다. 복구에 성공하면 R2 객체와 버전이 포함된 D1 인덱스를 자동으로 복구합니다. 따라서 브라우저에 캐시된 오래된 404가 스스로 복구되며 비공개 저장소 자격 증명은 브라우저에 노출되지 않습니다.

R2 오디오 백엔드도 아니고 카탈로그 데이터베이스도 아닙니다.

## 예약 작업

Cloudflare에서는 Wrangler Cron Trigger가 6시간마다 17분에 실행됩니다. Node에서는 `SOURCE_SCAN_HOURS`를 사용합니다(기본값 `6`, `0`이면 비활성화). 소스 스캔은 지원되는 RSS／Atom／Blogger의 제목과 링크만 읽으며 음악은 다운로드하지 않습니다.

`mihonban watch` 다릅니다: 실제 로컬 인박스를 감시하고 7-Zip/beets를 호출합니다. 해당 디렉터리에 접근할 수 있는 컴퓨터나 NAS에서 실행되어야 하며, Cloudflare Workers 내부에서는 실행할 수 없습니다.

## 백업 및 복구 계층

1. 카탈로그: SQLite 인식 백업 또는 D1 논리 SQL 내보내기.
2. 설정: 관리 화면의 설정 JSON. 저장할 때 암호화합니다.
3. 실행 시 시크릿: 비밀번호 관리자 또는 배포 플랫폼의 시크릿 저장소.
4. 오디오와 원본 이미지: 저장소 수준에서 독립적으로 백업.
5. KV: 재구성합니다. R2 이미지 인덱스는 같은 버킷을 유지할 때만 이전하고, 그 외에는 기존 공개 객체를 다시 등록하거나 예열로 재구성합니다.

전체 절차는 [데이터베이스 백업, 마이그레이션 및 복구](database-migration.ko.md)를 참고하세요.

## 호스팅 경계

Cloudflare의 무료 요금제는 개인 라이브러리나 소수의 청취자에 적합할 수 있지만, 할당량과 용어는 변경됩니다. API 요청, D1 행, KV 연산, R2, 프록시 오디오 모두 플랫폼 자원을 소비합니다. OneDrive 임시 URL은 일반적으로 Worker를 우회합니다; WebDAV, Google Drive, 로컬 Node 스트림, 활성화된 프록시 경로는 그렇지 않습니다.

Workers는 가정용 컴퓨터의 폴더에 접근하거나 파일 시스템 이벤트를 기다리며 상주할 수 없습니다. 오디오 변환, beets 실행, 압축 파일 해제도 할 수 없습니다. 이러한 작업에는 선택적 로컬 컴패니언을 사용하세요.

## 진단

Cloudflare:

```bash
cd cloud/worker
npx wrangler tail
npx wrangler d1 execute mihonban --remote --config wrangler.local.jsonc \
  --command "SELECT COUNT(*) AS albums FROM albums"
```

로컬 Wrangler에서는 같은 명령에 `--local`을 사용합니다. Node에서는 `DATA_DIR`, 시작 로그와 관리 화면의 시스템 상태를 확인하세요. 새로 고침 토큰, 서명된 오디오 URL, 설정 내보내기 또는 요청의 인증 헤더를 로그에 출력하지 마세요.
