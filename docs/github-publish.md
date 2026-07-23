# Publish the code safely

This repository should contain source code, tests, documentation, and safe templates only. Audio, saved RYM pages, databases, backups, and credentials stay private.

## Pre-push checks

```bash
git status --short
git diff --check
git grep -n -I -i -E "refresh[_-]?token|client[_-]?secret|access[_-]?key|proxy[_-]?secret" -- .
```

Review matches manually; templates and variable names are expected, real values are not.

Never track:

- `.dev.vars`, `.env`, `mihonban.toml`, `rclone.conf`
- `backups/`, `*.sqlite`, `*.db`, exported settings JSON
- Audio, covers from the personal library, or RYM HTML archives
- Cloudflare, Azure, Google, WebDAV, Discogs, or R2 credentials

Before the first public push, use a secret scanner such as Gitleaks on the full history.

Also review commit identity before publishing history:

```bash
git log --all --format='%an <%ae>' | sort -u
```

This repository uses `AGPL-3.0-only`. Keep the root `LICENSE` file when publishing or redistributing the project.

## Validate the repository

```bash
python -m pytest -q
cd cloud/worker && npm ci && npm test && npx wrangler deploy --dry-run
cd ../proxy-worker && npm ci && npm test && npx wrangler deploy --dry-run
cd ../web && npm ci && npm run build
```

Do not add generated `dist`, `.wrangler`, `node_modules`, databases, or backup SQL to make CI pass.

## Create the remote

```bash
gh auth login
gh repo create mihonban --private --source=. --remote=origin --push
```

Or create an empty repository on GitHub and add it manually:

```bash
git remote add origin git@github.com:<you>/mihonban.git
git push -u origin HEAD
```

Private visibility is the conservative default. If publishing publicly, review licenses for every bundled asset and make clear that no music is distributed.

## CI secrets

- Build and unit tests need no production secrets.
- Do not run deployment workflows from untrusted pull requests.
- Use GitHub environments and least-privilege Cloudflare tokens for deployment.
- Never place OneDrive/R2 credentials in frontend build variables.

## Release checklist

- Documentation links resolve.
- Fresh clone installs with `npm ci` and `pip install -e ./pipeline`.
- D1 migration and proxy tests pass.
- No machine-specific paths or real service URLs are documented.
- `git status` contains no untracked secret/config file.
- Production secrets that ever appeared in chat, logs, screenshots, or history have been rotated.

## If a secret was committed

1. Revoke/rotate it at the provider immediately.
2. Remove it from current files.
3. Rewrite history with `git filter-repo` or BFG if required.
4. Force-push only after coordinating with collaborators.
5. Assume every prior copy remains compromised.

Deleting a line in a later commit is not sufficient.
