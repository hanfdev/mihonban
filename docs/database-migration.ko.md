# 데이터베이스 백업, 마이그레이션 및 복구

[English](database-migration.md) · [简体中文](database-migration.zh.md) · [繁體中文](database-migration.zh-Hant.md) · [日本語](database-migration.ja.md) · [한국어](database-migration.ko.md) · [Français](database-migration.fr.md) · [Español](database-migration.es.md)

이 문서는 카탈로그를 지역 Node SQLite, 지역 Wrangler D1, 원격 Cloudflare D1 간에 이동시킵니다.

로컬에 머무르면 백업 `<DATA_DIR>/mihonban.sqlite`, 관리자 설정의 JSON, runtime 비밀, 오디오를 따로 설정하세요. 원격 섹션은 실제로 Cloudflare 배포가 있을 때만 적용됩니다.

## 옮겨야 할 것들

| 데이터 | 마이그레이션 경로 |
|---|---|
| 앨범, 트랙, 아티스트, 갤러리, 즐겨찾기, 노트, 소스 게시물 | D1 SQL 내보내기/가져오기 |
| OneDrive/R2/모듈 설정 및 이름 있는 스토리지 구성 | 관리자 설정 JSON |
| 앱/관리자 비밀번호, 세션 비밀, 동반 키, 프록시 서명 비밀 | 대상 Worker 비밀로 설정하기 |
| KV 속도 제한과 단기 캐시 | 마이그레이션하지 마세요 |
| R2 캐시 인덱스 | 같은 버킷: `--include-cache`로 내보내기; 새 버킷: 생략 및 사전 예열 |
| 오디오 및 원본 이미지 | 저장 계층에서 복사/마이그레이션; D1의 일부가 아님 |

관리자 JSON 단독으로는 카탈로그 백업이 아닙니다. D1 SQL 파일만으로는 오디오나 기본적으로 자격 증명을 포함하지 않습니다.

## Node 로컬 스토리지를 Cloudflare로 옮기기 전에

Cloudflare Node `local` 백엔드를 읽을 수 없습니다. 예전 Node 앱은 여전히 사용 가능하지만:

1. OneDrive, WebDAV, 또는 Google Drive을 추가하고 테스트합니다.
2. 로컬 저장소에 묶인 모든 앨범을 마이그레이션하세요.
3. 클라우드 백엔드에서 스트림과 이미지를 검증합니다.
4. 그 다음 데이터베이스를 내보내세요.

## 1. 원본 백업

이전 앱에서 관리자로 로그인하고 **Admin → 백업 설정**을 다운로드하세요. 그 JSON을 암호화하여 저장하세요.

Node 데이터베이스는 `<DATA_DIR>/mihonban.sqlite`. 로컬 Wrangler D1 파일은 `cloud/worker/.wrangler/state/v3/d1/` 아래에 있습니다.

최종 컷오버 시 쓰기를 멈춥니다. 익스포터는 SQLite 읽기 트랜잭션을 사용하지만, 동시 편집을 피하면 검증이 더 쉽습니다.

## 2. 대상 준비

D1/KV를 만들고, 공개 템플릿을 무시한 로컬 설정에 복사한 뒤,
해당 로컬 파일에 있는 실식별 번호를 입력하고, 스키마를 적용합니다:

```bash
cd cloud/worker
npm ci
cp wrangler.jsonc wrangler.local.jsonc
# wrangler.local.jsonc의 0으로 된 D1／KV ID를 실제 값으로 바꿉니다.
npx wrangler d1 execute mihonban --remote --file schema.sql \
  --config wrangler.local.jsonc
```

PowerShell에서는 `Copy-Item wrangler.jsonc wrangler.local.jsonc`를 사용하세요. D1
리소스 이름은 설정과 Worker 일치하는 `mihonban`입니다. 절대 계정을 입력하지 마세요
공개 템플릿에 리소스 ID 또는 배포 비밀을 포함합니다.

목표에 이미 중요한 데이터가 있다면, 먼저 내보내세요:

```bash
mkdir -p ../../backups
npx wrangler d1 export mihonban --remote \
  --output ../../backups/remote-before-import.sql \
  --config wrangler.local.jsonc
```

## 3. 라이브러리 데이터 내보내기 및 가져오기

### Windows 도우미

저장소 루트에서:

```powershell
powershell -File tools\migrate-d1.ps1 -ImportRemote
```

헬퍼는 최신 Node SQLite 또는 로컬 Wrangler D1을 자동으로 감지하고 무시된 `backups/` 아래에 타임스탬프가 붙은 SQL 파일을 작성합니다. 원격 D1는 `-ImportRemote` 있을 때만 쓰며; 내보내기 때만 해당 스위치를 생략합니다. 원격 가져오기 전에 현재 대상을 `backups/`로 내보내고 백업이 실패하면 중단합니다. `-SkipRemoteBackup` 명시적 긴급 오버라이드입니다.

헬퍼는 존재할 때 무시하는 `cloud/worker/wrangler.local.jsonc`을 선호하고, 그렇지 않으면 공개 템플릿을 사용합니다. 다른 개인 설정을 선택하려면 `-WranglerConfig <path>` 패스하세요.

대상이 정확히 같은 R2 버킷과 공개 URL을 유지할 때, 추가하세요
`-IncludeCache` 미리 워밍이 이미 거기에 미러링된 객체를 건너뛸 수 있도록 합니다:

```powershell
powershell -File tools\migrate-d1.ps1 `
  -Source "D:\mihonban-data\mihonban.sqlite" `
  -IncludeCache -ImportRemote
```

빈 버킷/다른 버킷으로 이동할 때 그 인덱스는 포함하지 마세요: 그 버킷의 행들
존재하지 않는 객체를 가리키는 것입니다. 만약 인덱스가 생략되어 있을 때
동일한 공공 객체가 여전히 존재하며, 현재의 예비 검사는 결정론적입니다
객체 URL에 HEAD 표시를 하고 이미지 바이트를 다시 업로드하지 않고 인덱스를 되찾습니다.

여러 로컬 데이터베이스가 존재할 때는 수정 시간에 의존하지 말고 항상 `-Source`을 패스하세요.

명확한 출처:

```powershell
powershell -File tools\migrate-d1.ps1 `
  -Source "D:\mihonban-data\mihonban.sqlite" `
  -Database "mihonban" `
  -WranglerConfig "cloud\worker\wrangler.local.jsonc" `
  -ImportRemote
```

### 수동/크로스 플랫폼

```bash
cd cloud/worker
npm ci
npm run db:export -- \
  --source /path/to/mihonban.sqlite \
  --output ../../backups/mihonban-d1.sql

npx wrangler d1 execute mihonban --remote \
  --file ../../backups/mihonban-d1.sql \
  --config wrangler.local.jsonc
```

기본 모드는 기본 키 UPSERT를 사용하며 소스에 없는 대상 행을 유지합니다. 다른 ID를 가진 고유 경로가 충돌하면 데이터를 조용히 삭제하는 대신 실패합니다. 새 대상의 경우 정확한 소스 카탈로그가 생성됩니다. `--replace` 포함된 카탈로그 테이블을 먼저 지우며; 원격 백업 후에만 사용합니다.

생성된 SQL은 의도적으로 명시적 `BEGIN TRANSACTION` 없거나
`COMMIT`: 현재 원격 D1 가져오기는 해당 문장을 거부하고 Wrangler 적용됩니다
원자적으로 업로드된 파일을 말이죠. 내보내기는 여전히 한 SQLite 내에서 소스를 읽습니다
트랜잭션 때문에 스냅샷이 일관됩니다.

`--include-config` 이름이 붙은 저장소와 동일한 허용 설정도 내보내줍니다
관리자 백업으로, SQL은 저장소와 서비스 자격 증명을 포함합니다.
의도적으로 리스너/관리자 비밀번호 해시, 세션 에포크, 컴패니언을 제외합니다
심장 박동, 스캔 타임스탬프, 오류 입력. 대상 비밀번호 Worker 설정하고
비밀runtime 독립적으로 처리하세요. 별도의 관리자 JSON은 여전히 권장됩니다
구성 경로. `--replace` 있어도 허용된 설정 키만 허용됩니다
교체되며; 대상 인증과 runtime 상태 행은 그대로 유지됩니다.
같은 R2 버킷에 대해 `--include-cache`을 추가하세요; 새 버킷을 위해 생략하세요.

## 4. 설정과 시크릿 복원

1. 새로운 `APP_PASSWORD`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `COMPANION_KEY` 비밀을 가진 메인 Worker을 배치한다.
2. 새 관리자 비밀번호로 로그인.
3. 관리자 → 백업 설정 → 이전 JSON 가져오기.
4. 모든 저장 공간과 R2 구성을 테스트합니다.
5. 외부 오디오 프록시를 사용할 경우, 메인 Worker에 `STREAM_PROXY_SECRET`를 설정하고 프록시 Worker에서 `PROXY_SECRET` 값과 동일하게 설정하세요.

JSON은 의도적으로 비밀번호 해시나 세션 상태를 복원하지 않습니다.

## 5. 개수와 동작 확인

```bash
npx wrangler d1 execute mihonban --remote --config wrangler.local.jsonc --command \
  "SELECT COUNT(*) AS albums FROM albums"
npx wrangler d1 execute mihonban --remote --config wrangler.local.jsonc --command \
  "SELECT COUNT(*) AS tracks FROM tracks"
npx wrangler d1 execute mihonban --remote --config wrangler.local.jsonc --command \
  "SELECT COUNT(*) AS artists FROM artists"
```

그 다음 다음을 확인하세요:

- 앨범, 트랙, 아티스트, 즐겨찾기, 노트, 숨겨진 상태, 순서
- 스토리지 백엔드당 하나의 트랙, 탐색 포함.
- 표지, 아바타, 갤러리 이미지.
- 리스너는 숨겨진 객체에 접근할 수 없습니다.
- 관리자 설정이 새 배포에서 내보내기 동작.
- R2 인덱스가 누락된 경우, 프리워밍을 실행: 기존 공개 객체는 HEAD로 회수되고 누락된 객체만 업로드됩니다.

## 6. 컷오버 및 롤백

검증 후에만 동반 `[cloud].url`을 업데이트하세요. 새 배포가 복원 테스트를 통과할 때까지 기존 데이터베이스, 이전 배포, SQL 백업, 설정 JSON, 소스 오디오를 유지하세요.

롤백은 URL을 이전 배포로 되돌리거나, 미리 임포트한 원격 SQL 백업을 깨끗한 D1 데이터베이스로 가져오는 것입니다. 데이터베이스 컷오버 중에는 유일한 오디오 복사본을 절대 삭제하지 마세요.

## 원격 간 마이그레이션

두 번의 Cloudflare 배포 시에는 스키마를 적용한 후 기존 원격 D1을 내보내고 새 원격 처리로 가져오세요. 같은 구분을 유지하세요: 카탈로그는 D1 SQL, 구성은 관리자 JSON, 비밀은 독립적으로 설정Worker.
