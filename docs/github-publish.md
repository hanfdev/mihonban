# Publish the code safely

[中文](github-publish.zh.md)

The canonical public repository is [hanfdev/mihonban](https://github.com/hanfdev/mihonban). It should contain source, tests, public documentation, and safe templates only.

## Never track

- `.dev.vars`, `.env`, `mihonban.toml`, `rclone.conf`, `wrangler.local.jsonc`, or provider configuration
- `backups/`, `*.sqlite`, `*.db`, SQL exports, or Admin settings JSON
- Audio, personal covers/galleries, saved RYM pages, or inbox archives
- Cloudflare, Azure, Google, WebDAV, Discogs, R2, proxy, or companion credentials
- `GOAL.local.md` and other private planning/agent notes
- Generated `node_modules`, `.wrangler`, build output, logs, or temporary files

The root `.gitignore` covers the standard locations, but ignore rules do not remove a file that was already committed.

## Before every push

```bash
git status --short
git diff --check
git diff --stat
git grep -n -I -i -E "refresh[_-]?token|client[_-]?secret|access[_-]?key|proxy[_-]?secret" -- .
```

Review every match manually. Variable names and redacted examples are expected; real values are not. Also check the commit author identity:

```bash
git log -5 --format='%h %an <%ae> %s'
```

Before the first public release or after a history rewrite, run a dedicated scanner such as Gitleaks against all refs.

## Validate the repository

From the repository root:

```bash
python -m pytest -q
```

Then in each package:

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

Do not add ignored build output, local D1 state, databases, or backups merely to make CI pass.

## Remotes and forks

Confirm the destination before pushing:

```bash
git remote -v
git branch --show-current
```

The canonical origin is:

```text
https://github.com/hanfdev/mihonban.git
```

For a personal fork, point `origin` at the fork and retain the canonical repository as `upstream`:

```bash
git remote add upstream https://github.com/hanfdev/mihonban.git
git fetch upstream
```

Do not push local recovery branches or ignored backup material.

## CI and deployment secrets

- Build and unit tests require no production secrets.
- Untrusted pull requests must not receive deployment secrets.
- Use GitHub environments and least-privilege Cloudflare API tokens for deployment.
- Never place storage or R2 credentials in frontend build variables.
- Rotate any production secret that appeared in chat, logs, screenshots, CI output, or Git history.

## Release checklist

- English and Chinese document pairs both exist and cross-link correctly.
- A fresh clone installs with `npm ci` and `pip install -e ./pipeline`.
- Python, frontend, main Worker, proxy Worker, and dry-run checks pass.
- Documentation contains no machine-specific path, personal service URL, or credential.
- Database/schema migration notes match the released code.
- No private music or third-party copyrighted asset is bundled.
- `LICENSE` remains present and package metadata still declares `AGPL-3.0-only`.

## If a secret was committed

1. Revoke or rotate it at the provider immediately.
2. Remove it from current files and deployments.
3. Rewrite affected history with `git filter-repo` or BFG when required.
4. Force-push only after coordinating with every collaborator.
5. Treat all old clones, logs, and artifacts as compromised copies.

Deleting the value in a later commit does not remove it from history.

## License boundary

The AGPL covers this repository's software. It does not grant permission to publish music, personal library images, or third-party metadata. Every release must preserve that distinction.
