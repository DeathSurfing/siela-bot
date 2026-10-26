# Release

This document covers the path from a branch to a deployed change. Local setup is in [GET_STARTED.md](../GET_STARTED.md). Day-to-day development is in [DEVELOPMENT.md](DEVELOPMENT.md). Operational procedures are in [RUNBOOK.md](RUNBOOK.md).

## Branches and pull requests

- Branch from current `main`.
- Use a short descriptive branch name, for example `feat/relic-trades`, `fix/music-queue`, `docs/contributor-onboarding`, or `chore/dependabot`.
- Keep one coherent change per pull request. Split unrelated refactors, dependency bumps, and behavior changes.
- Add or update tests and documentation in the same branch.
- Use the pull request template at `.github/PULL_REQUEST_TEMPLATE.md`. Describe the problem, the change, the verification, and any migration, environment, or deployment impact.
- Link the issue when one exists.
- Keep the branch current with `main`. Resolve conflicts locally and rerun the checks.
- Do not commit secrets, `.env` files, database dumps, or personal data.
- A pull request is ready to merge when CI is green, the diff is focused, and the migration and rollback impact is clear.

## Pre-merge checks

Run from the repository root on Bun 1.4.2:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
```

What each command covers:

- `bun install --frozen-lockfile` fails when `package.json` and `bun.lock` disagree. Commit the lockfile when dependencies change.
- `bun run typecheck` checks `packages/shared`, `packages/config`, `packages/db`, `apps/watchtower`, and `apps/bot`.
- `bun run test` runs the shared package tests, then the bot tests.
- `bun run build` bundles `apps/bot` and `apps/watchtower` into `dist/`.

The CI workflow `.github/workflows/ci.yml` runs the same commands on Ubuntu with Bun 1.4.2. A local pass does not replace CI when the change touches platform-specific code, voice, native modules, or container files.

Checklist:

- [ ] The branch is based on current `main`
- [ ] CI is green
- [ ] New behavior has tests or a documented reason tests are impractical
- [ ] User-facing and operator-facing documentation is updated
- [ ] New environment variables are documented and added to the deployment env file
- [ ] Migration SQL is reviewed
- [ ] No secrets or local data are committed
- [ ] The rollback path is understood

## Migration and deployment checklist

Treat schema changes as forward only. Drizzle applies pending migrations and does not generate down migrations. Restoring a backup is the reliable rollback for a destructive change.

Before merging a migration:

1. Generate it with `bun run db:generate` and review the SQL under `packages/db/drizzle/`.
2. Confirm the change is compatible with the currently deployed bot during a restart. Additive columns and tables are safer than drops or renames.
3. Take a database backup using the commands in [RUNBOOK.md](RUNBOOK.md#backups). Do not skip this for a destructive migration.
4. Document the migration, the expected duration, and the rollback plan in the pull request.

Deploy from the host:

```bash
git pull --ff-only
./scripts/podman-stack.sh build
./scripts/podman-stack.sh run --rm migrate
./scripts/podman-stack.sh up -d
```

For a code-only change, the fast overlay is available:

```bash
REMOTE=user@host SSH_KEY=~/.ssh/your-key ./scripts/deploy-fast.sh
```

Deployment checklist:

- [ ] A backup exists and its path is recorded
- [ ] `deploy/podman/.env` has every new variable and secret
- [ ] The new image is built
- [ ] `migrate` exits 0
- [ ] The bot container is recreated and running
- [ ] No migration is left pending
- [ ] Post-deploy checks pass

Compose starts `migrate` and `bot` without waiting for the one-shot migration to finish. Run `migrate` explicitly before `up -d`, or restart the bot if it started against the old schema.

## Post-deploy verification

Query readiness from inside the bot container. Port 3002 is not published.

```bash
podman exec siela-bot python3 -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:3002/readyz', timeout=10).read().decode())"
```

A healthy response is HTTP 200 with `gateway`, `guild`, and `database` set to `true`. A 503 means at least one check is false. `podman healthcheck run siela-bot` only checks `/healthz`, which proves the process is alive, not that Discord is connected.

Check the logs:

```bash
./scripts/podman-stack.sh logs --tail=200 bot
podman logs siela-bot | grep -E 'bot logged in|gateway ready|guild commands registered|guild initialized'
podman logs siela-bot | grep -iE 'error|warn' | tail -50
```

Then run a smoke command in the test or production guild:

```text
!ping
```

Expect a response with gateway, round trip, uptime, music, and database status. Follow with `!help` and `/help` when command registration changed. For a voice change, run `!join` and `!play <URL>` in a test channel.

Watch the logs for one full command cycle. Confirm there is no restart loop, no migration error, and no repeated reconnect warning.

## Rollback

Use the least destructive rollback that fixes the problem.

1. Code-only regression: revert the commit through the normal pull request path, then rebuild and redeploy.

```bash
git revert <commit>
git push origin HEAD:rollback/<incident>
```

2. Configuration regression: restore the previous `deploy/podman/.env`, then recreate the affected containers.

```bash
./scripts/podman-stack.sh up -d --force-recreate
```

3. Bad or incompatible migration: stop writers, restore the most recent database backup, then start the previous release. Follow the backup and restore commands in [RUNBOOK.md](RUNBOOK.md#backups).
4. Container or host failure: use the service checks and restart procedures in [RUNBOOK.md](RUNBOOK.md).

Do not run `./scripts/podman-stack.sh down -v` as a rollback step. It deletes the database volume.

After a rollback, record what failed, which commands ran, and whether any data was lost. Open a follow-up issue with the failing logs and the migration or configuration that triggered it.
