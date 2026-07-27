# 설치 및 배포

[English](install.md) · [简体中文](install.zh.md) · [繁體中文](install.zh-Hant.md) · [日本語](install.ja.md) · [한국어](install.ko.md) · [Français](install.fr.md) · [Español](install.es.md)

이 가이드는 지원되는 세 가지 runtimes과 선택적으로 제공되는 로컬 Python 동반자를 다룹니다. 하나의 애플리케이션 runtime을 선택하세요; 동반 도구는 서버 요구사항이 아니라 추가 워크플로우 도구입니다.

## 1. 전제 조건

- Node.js 22 이상
- git
- Cloudflare Cloudflare에 배치할 때만 계정을 활성화
- OneDrive, WebDAV, 또는 Cloudflare 배치를 위한 Google Drive
- Python 3.11 또는 그 이후, 그리고 로컬 동반 차량에만 해당되는 7-Zip(`7z`, `7zz`, 또는 `7za`)
- 동반자 기반 로컬 간 클라우드 파일 동기화를 위한 선택적 `rclone`

라이브 SQLite 데이터베이스, `music_root`, `data_dir`, 임시 디렉터리 또는 `node_modules` OneDrive, 드롭박스, iCloud 또는 다른 동기화된 폴더에 배치하지 마십시오. 저장소 자체는 빌드 및 변경 데이터가 다른 곳에 스테이징되어 있을 경우 동기화될 수 있습니다.

정식 저장소를 복제합니다:

```bash
git clone https://github.com/hanfdev/mihonban.git
cd mihonban
```

## 2. 런타임 선택

| Runtime | 기본 URL | 데이터베이스 | 로컬 폴더 저장 |
|---|---|---|---:|
| Wrangler 로컬 | `http://127.0.0.1:8787` | 로컬 D1/KV 에뮬레이터 | 아니요 |
| Node | `http://127.0.0.1:8788` | `<DATA_DIR>/mihonban.sqlite` | 네 |
| Cloudflare | Worker URL/커스텀 도메인 | 원격 D1 + KV | 아니요 |

Wrangler 로컬 Cloudflare 가장 가깝습니다. Node 영구적인 로컬/NAS 서비스에 더 적합하며, 서버-로컬 폴더 백엔드를 읽을 수 있는 유일한 runtime입니다.

## 3. 로컬 Wrangler 개발

### Windows 도우미

저장소가 OneDrive 상태일 때는 다음을 사용하세요:

```powershell
tools\cloud-dev.cmd
```

헬퍼는 기본적으로 `cloud/`를 `%TEMP%\mihonban-cloud-build`에 복사하고, 그곳에 의존성을 설치하며, React를 빌드하고, 로컬 스키마를 적용한 후 기본값으로 `127.0.0.1:8787`(루프백)에서 Wrangler을 시작합니다. 실행 전에 `MIHONBAN_DEV_LAN=1`을 설정하면 `0.0.0.0:8787`로 노출되어 LAN의 휴대폰에서 테스트할 수 있습니다. `MIHONBAN_STAGE` 다른 비동기화 디렉터리로 설정하여 임시 디렉터리 정리 과정에서 로컬 D1을 유지합니다.

첫 실행 시 `.dev.vars`을 생성하며, 두 비밀번호를 포함한 모든 값이 무작위입니다:

```text
APP_PASSWORD=<무작위>
ADMIN_PASSWORD=<무작위>
```

리스너 비밀번호와 관리자 비밀번호는 `%TEMP%\mihonban-cloud-build\worker\.dev.vars`(또는 `%MIHONBAN_STAGE%\worker\.dev.vars`)에서 확인할 수 있습니다. 다른 사람이 접속할 수 있도록 하기 전에 관리자 모드에서 변경하세요.

### 수동 Wrangler 설정

```bash
cd cloud/web
npm ci
npm run build

cd ../worker
npm ci
# .env.example을 바탕으로 .dev.vars를 만들고 모든 자리 표시자를 바꿉니다.
# 로컬 HTTP에서는 DEV_INSECURE_COOKIE=1을 설정합니다.
npx wrangler d1 execute DB --local --file schema.sql
npx wrangler dev --ip 0.0.0.0 --port 8787
```

스테이징 보조기가 없으면 로컬 스테이트는 `cloud/worker/.wrangler/` 받게 됩니다. `.wrangler/`와 `.dev.vars` 모두 Git에 의해 무시됩니다.

휴대폰 테스트를 위해 휴대폰을 같은 LAN에 연결하고, 호스트 방화벽을 통과Node.js 허용하며, `http://<computer-lan-ip>:8787`을 열어주세요. 이 일반 HTTP 개발 서버를 인터넷에 노출하지 마세요.

## 4. 로컬 Node + SQLite

```bash
cd cloud/web
npm ci
npm run build

cd ../worker
npm ci
# Windows: Copy-Item .env.example .env
# POSIX:   cp .env.example .env
npm run node
```

시작하기 전에 수정 `.env`:

```dotenv
APP_PASSWORD=choose-a-listener-password
ADMIN_PASSWORD=choose-a-separate-admin-password
SESSION_SECRET=at-least-32-random-characters
DEV_INSECURE_COOKIE=1
DATA_DIR=D:/mihonban-data
PORT=8788
```

내장된 Node 비밀번호는 없습니다. `APP_PASSWORD` 리스너 비밀번호이며; 비밀번호 없는 게스트 접근은 별도의 관리자 토글입니다. 서버가 `0.0.0.0` 묶기 때문에, 방화벽이 포트를 허용한 후 LAN에서 `http://<computer-lan-ip>:8788` 작동합니다.

데이터베이스는 `<DATA_DIR>/mihonban.sqlite`; `DATA_DIR` 설정이 해제되면 기본값은 `cloud/worker/data/`로 설정됩니다. 앱이 멈추거나 SQLite 인식 도구를 사용할 때는 백업하세요. 공개 Node 배포는 신뢰할 수 있는 플랫폼이나 리버스 프록시 뒤에 HTTPS가 필요합니다. 요청이 항상 당신이 제어하는 프록시를 통과할 때만 `TRUST_PROXY=1` 설정하세요.

## 5. 선택 사항: Python 컴패니언

웹 업로드/가져오기만으로도 충분하다면 이 섹션은 건너뛰세요. 동반 기능을 설치하여 받은편지함 감시, 폴더 또는 단일 중첩 아카이브, 태그 복구, 로컬 조직화, 로컬/클라우드 조정을 지원하세요.

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate
pip install -e ./pipeline
mihonban setup
mihonban doctor
```

`mihonban setup` 저장소 외부에 사설 TOML을 작성합니다. `MIHONBAN_CONFIG` 현재 오버라이드 변수이지 레거시 별칭이 아닙니다. 룩업 순서는 명시적인 `--config`, `MIHONBAN_CONFIG`, `./mihonban.toml`, 그리고 플랫폼 사용자 설정 디렉터리입니다.

일반적인 명령:

```text
mihonban ingest --apply
mihonban watch
mihonban cloud sync
mihonban cloud pull
```

동반 도구는 지속적인 로컬 파일 시스템과 7-Zip, 비트 같은 외부 도구가 필요하기 때문에 Cloudflare Workers 내부에서 실행될 수 없습니다.

## 6. Cloudflare 배포

수동 경로는 정사(canonic)이며 동반자가 필요하지 않습니다.

```bash
cd cloud/web
npm ci
npm run build

cd ../worker
npm ci
npx wrangler login
npx wrangler d1 create mihonban
npx wrangler kv namespace create mihonban-kv --binding KV
```

`d1 create` 때 `--location apac`(또는 다른 지원 위치 힌트)를 추가하세요
명시적인 기본 리전이 필요합니다. 공개 설정을 무시한 곳에 복사하세요
로컬 배포 설정, 그리고 그 0자리 자리 표시자를 반환된 것으로 대체합니다
D1 및 KV 신분증:

만약 Wrangler 리소스를 생성하면서 현재 설정을 업데이트하겠다고 제안한다면,
답변 **아니오**; 실제 ID는 아래에 생성된 개인 사본에 속합니다.

```bash
cp wrangler.jsonc wrangler.local.jsonc
```

PowerShell은 `Copy-Item wrangler.jsonc wrangler.local.jsonc`를 사용합니다. 현실을 지키세요
계정 ID와 공개 `wrangler.jsonc` 밖의 모든 비밀을 공개합니다. 그다음 실행하세요:

```bash
npx wrangler d1 execute mihonban --remote --file schema.sql --config wrangler.local.jsonc
npx wrangler secret put APP_PASSWORD --config wrangler.local.jsonc
npx wrangler secret put ADMIN_PASSWORD --config wrangler.local.jsonc
npx wrangler secret put SESSION_SECRET --config wrangler.local.jsonc
npx wrangler deploy --config wrangler.local.jsonc
```

배포Cloudflare 기본 리스너나 관리자 비밀번호가 없습니다. 고유 값을 입력하고 최소 32개의 임의 문자를 사용`SESSION_SECRET`. 로컬 동료가 배포를 호출할 때만 `COMPANION_KEY` 추가하세요:

```bash
npx wrangler secret put COMPANION_KEY --config wrangler.local.jsonc
npx wrangler deploy --config wrangler.local.jsonc
```

동일한 Worker가 `/api/*`와 구축된 React 자산을 지원합니다. 별도의 프론트엔드 호스트는 필요하지 않습니다.

### 선택적 Windows 통합 마법사

`tools\deploy-cloud.cmd` 리소스 제공, 두 비밀번호 Cloudflare 프롬프트, 임의 세션/동반자 비밀 업로드, 동반 `[cloud]` 섹션 작성, 첫 동기화 수행, 감시자 설치를 수행합니다. 통합 Windows 워크플로우에만 사용하세요; 클라우드 전용 사용자는 위의 수동 명령을 사용해야 합니다.

## 7. 스토리지 구성

관리자로 로그인하고 이름 있는 백엔드를 추가하세요. 업로드 전에 한 개의 백엔드를 쓰기 대상으로 선택해야 합니다.

### OneDrive

파일 읽기/쓰기 및 오프라인 권한이 위임된 Azure 애플리케이션을 생성하세요. 관리자 모드에서 클라이언트 ID, 클라이언트 비밀, 새로고침 토큰, 드라이브 ID를 입력한 후 백엔드를 테스트하세요. 재생OneDrive 보통 임시 URL을 사용하며 Worker를 우회할 수 있습니다.

### WebDAV

라이브러리 루트 URL과 자격 증명을 입력하세요. 재생과 업로드는 메인 Worker를 통과합니다. WebDAV 임시 공개 다운로드 URL이 없기 때문입니다.

### Google Drive

Drive API를 활성화하고 데스크톱 OAuth 클라이언트를 생성하세요. 관리자 모드에서 인증 URL을 생성하고 승인한 뒤, 필요 시 `http://localhost`에서 `code`을 복사한 후 교환한 후 백엔드를 테스트하고 추가하세요. 기존 라이브러리 탐색과 업로드를 위해 Writable Drive 범위가 필요합니다.

### 로컬 폴더

Node runtime에서만 제공됩니다. 설정된 루트는 서버의 파일 시스템 내에 있어야 하며 Cloudflare에 이식할 수 없습니다. [스토리지 백엔드 및 파일 마이그레이션](storage.ko.md).

## 8. 선택적 R2 이미지 미러

R2 카탈로그 데이터베이스나 오디오 백엔드가 아니라 재구축 가능한 이미지 미러입니다. 버킷, 공개 읽기 URL, S3 호환 읽기/쓰기 토큰을 생성하고; 관리자, 테스트, 활성화, 사전 예열에 입력하세요. 액세스 키와 비밀은 Git에 넣지 마세요. 같은 버킷을 유지하면서 마이그레이션할 때는 `-IncludeCache`로 `r2_cache`을 보존하세요; 새 버킷을 만들 때는 버킷을 생략하고 예비 준비하세요.

## 9. 기존 데이터베이스 이동

빈 배포를 만들고 설정 복원이 앨범을 다시 가져올 것이라고 가정하지 마세요. 카탈로그 데이터, 설정, runtime 비밀, 오디오는 별도의 레이어입니다. 전환 전에 [데이터베이스 백업, 마이그레이션, 복구](database-migration.ko.md)를 따라가runtimes.

## 10. 선택적 오디오 프록시

메인 Worker는 이미 비공개 자격 증명이 필요한 백엔드를 프록시합니다. 두 번째 Cloudflare 경로나 사용자 지정 도메인이 임시 URL 재생 경로를 실제로 개선하는 경우에만 `cloud/proxy-worker`를 배포하세요. [선택적 Cloudflare 오디오 프록시](audio-proxy.ko.md)를 참고하세요.

## 11. 업데이트

중요한 업데이트 전에 데이터베이스와 관리자 설정 JSON을 백업하세요.

Cloudflare:

```bash
git pull
cd cloud/web && npm ci && npm run build
cd ../worker && npm ci
npx wrangler d1 execute mihonban --remote --file schema.sql --config wrangler.local.jsonc
npx wrangler deploy --config wrangler.local.jsonc
```

Node: `cloud/web`를 재구축하고, Worker 의존성을 재설치하며, 이전 프로세스를 중지한 후 `npm run node` 재시작하세요. `schema.sql` 반복 가능하며, 마이그레이션runtime 이전 데이터베이스에 필요한 열을 추가합니다.

## 12. 검증

- 리스너 및 관리자 비밀번호로 로그인; 활성화된 경우에만 비밀번호 없는 게스트 모드를 테스트합니다.
- 오픈 라이브러리, 트랙, 아티스트, 즐겨찾기, 가져오기, 관리자 경로
- 트랙을 재생하고, 끝부분을 찾고, iOS/Android에서 시스템 미디어 제어를 테스트합니다.
- 커버, 아티스트 아바타, 앨범 갤러리를 열기; 모바일에서 테스트 갤러리 스와이프.
- 숨겨진 앨범, 트랙, 아티스트, 스타일, 이미지, 검색 결과, 즐겨찾기 목록이 청취자에게 제공되지 않는지 확인하세요.
- 선택한 글쓰기 대상에 일회용 앨범 하나를 업로드한 후 삭제합니다.
- 데이터베이스 백업과 관리자 설정 JSON 파일을 모두 내보내기.

## 문제 해결

| 증상 | 확인 |
|---|---|
| 로그인은 즉시 로그인 페이지로 돌아갑니다 | 로컬 HTTP는 `DEV_INSECURE_COOKIE=1` 필요합니다; 공개 배포는 HTTPS 필요 |
| 이전 환경 비밀번호가 거부됨 | 관리자 모드에 저장된 비밀번호는 해시로 저장되며 우선권을 가집니다 |
| 스트림 반환 502 | 명명된 백엔드 바인딩, 자격 증명, 상대 경로, 그리고 상류 Range 지원 |
| 기존 앨범이 누락됨 | 카탈로그 데이터베이스 복원; 설정: JSON에 앨범이 포함되지 않음 |
| Wrangler 비어 있어 보입니다 | 명령어가 `--local`인지 `--remote`인지, 그리고 어떤 스테이지 디렉터리가 `.wrangler/` |
| Node 비어 있어 보입니다 | `DATA_DIR` 의도된 `mihonban.sqlite`을 가리키는지 확인 |
| 전화기가 연결할 수 없음 | LAN IP를 사용하고 `0.0.0.0` 묶은 후 선택한 포트를 방화벽을 통과할 수 있도록 허용합니다 |
| 로그인 결과 429 | 재시도를 멈추고 소스 IP 잠금 해제가 만료될 때까지 15분간 기다려 주세요 |
