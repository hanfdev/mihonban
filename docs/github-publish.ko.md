# 코드를 안전하게 공개하세요

[English](github-publish.md) · [简体中文](github-publish.zh.md) · [繁體中文](github-publish.zh-Hant.md) · [日本語](github-publish.ja.md) · [한국어](github-publish.ko.md) · [Français](github-publish.fr.md) · [Español](github-publish.es.md)

공식 공개 저장소는 [hanfdev/mihonban](https://github.com/hanfdev/mihonban)입니다. 소스 코드, 테스트, 공개 문서와 안전한 템플릿만 포함해야 합니다.

## 절대 추적하지 말아야 할 항목

- `.dev.vars`, `.env`, `mihonban.toml`, `rclone.conf`, `wrangler.local.jsonc` 또는 제공자 구성
- `backups/`, `*.sqlite`, `*.db`, SQL 내보내기, 또는 관리자 설정 JSON
- 오디오, 개인 커버/갤러리, 저장된 RYM 페이지, 또는 받은 편지함 아카이브
- Cloudflare, Azure, Google, WebDAV, Discogs, R2, 프록시 또는 동반자 자격 증명
- `GOAL.local.md` 및 기타 민간 계획/중개인 노트
- 생성된 `node_modules`, `.wrangler`, 빌드 출력, 로그 또는 임시 파일

루트 `.gitignore`은 표준 위치를 포함하지만, 규칙을 무시하면 이미 커밋된 파일을 삭제하지 않습니다.

## push 전 확인

```bash
git status --short
git diff --check
git diff --stat
git grep -n -I -i -E "refresh[_-]?token|client[_-]?secret|access[_-]?key|proxy[_-]?secret" -- .
```

모든 매칭을 수동으로 검토하세요. 변수 이름과 편집된 예제는 기대됩니다; 실제 값은 그렇지 않습니다. 또한 커밋 작성자 신원도 확인하세요:

```bash
git log -5 --format='%h %an <%ae> %s'
```

첫 공개 릴리스 전이나 기록 재작성 후에, 모든 참조에 대해 Gitleaks 같은 전용 스캐너를 실행하세요.

## 저장소 검증

저장소 루트에서:

```bash
python -m pytest -q
```

그리고 각 패키지에서는:

```bash
cd cloud/web
npm ci
npm test
npm run build

cd ../worker
npm ci
npm test
npx wrangler deploy --dry-run

cd ../proxy-worker
npm ci
npm test
npx wrangler deploy --dry-run
```

CI 통과를 위해 무시된 빌드 출력, 로컬 D1 상태, 데이터베이스, 백업을 추가하지 마세요.

## remote와 fork

누르기 전에 목적지를 확인하세요:

```bash
git remote -v
git branch --show-current
```

정경적 기원은 다음과 같습니다:

```text
https://github.com/hanfdev/mihonban.git
```

개인적인 fork을 위해 fork를 `origin` 가리키고 정식 저장소를 다음과 같이 보관하세요`upstream`:

```bash
git remote add upstream https://github.com/hanfdev/mihonban.git
git fetch upstream
```

로컬 복구 브랜치나 무시된 백업 자료를 push하지 마세요.

## CI 및 배포 시크릿

- 빌드 및 단위 테스트는 생산 비밀이 필요하지 않습니다.
- 신뢰할 수 없는 pull requests은 배포 비밀을 받아서는 안 됩니다.
- 배포GitHub 환경과 최소 권한 Cloudflare API 토큰을 사용합니다.
- 프론트엔드 빌드 변수에 저장소나 R2 자격 증명을 절대 넣지 마세요.
- 채팅, 로그, 스크린샷, CI 출력, 또는 Git 기록에 나타나는 모든 생산 비밀을 순환 배치합니다.

## 출시 체크리스트

- 모든 공개 안내서는 영어, 간체자, 번체자, 일본어, 한국어, 프랑스어, 스페인어 버전이 있으며, 유효한 다국어 링크가 포함되어 있습니다.
- `npm ci`와 `pip install -e ./pipeline` 함께 새 클론을 설치합니다.
- Python, 프론트엔드, 메인 Worker, 프록시 Worker, 그리고 사전 실행 체크가 통과됩니다.
- 문서에는 기계별 경로, 개인 서비스 URL, 자격 증명이 포함되어 있지 않습니다.
- 데이터베이스/스키마 마이그레이션 노트가 공개된 코드와 일치합니다.
- 개인 음악이나 제3자 저작권 자산은 번들로 제공되지 않습니다.
- `LICENSE`는 여전히 존재하며 패키지 메타데이터는 여전히 `AGPL-3.0-only`을 선언합니다.

## 시크릿을 커밋한 경우

1. 즉시 제공자에게 취소하거나 순환 근무하세요.
2. 현재 파일과 배포에서 제거하세요.
3. 필요 시 `git filter-repo` 또는 BFG로 영향을 받은 역사를 다시 쓰기.
4. 모든 협력자와 협조한 후에만 포스push.
5. 모든 오래된 복제본, 로그, 유물을 손상된 복사본으로 취급하세요.

이후 커밋에서 값을 삭제해도 그 값이 역사에서 사라지지 않습니다.

## 라이선스 범위

AGPL은 이 저장소의 소프트웨어를 다룹니다. 음악, 개인 라이브러리 이미지, 제3자 메타데이터 공개 권한을 부여하지 않습니다. 모든 릴리스는 그 구분을 유지해야 합니다.
