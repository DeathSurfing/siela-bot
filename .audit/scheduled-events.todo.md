# Scheduled voice events

- [x] Read the Principles section of the poteto-mode skill.
- [x] Phase A: Frame the definition of done, scope, blockers, and rigor.
- [x] Phase B: Design the workflow and write the phase list.
- [ ] Phase C: Run each unit as an experiment, verify it, and commit only green units.
- [ ] Phase D: Keep the audit trail current.
- [ ] Phase E: Verify the full result against the definition of done and hand it back.
- [x] Unit 1: Add scheduled-event tables, generate and inspect the migration, and add tested YouTube normalization and next-run rules.
- [x] Unit 2: Add the persisted service methods, playback exclusion, run history, and scheduler execution.
- [x] Unit 3: Add token-protected control routes, administrator and channel checks, feature gating, and audit records.
- [ ] Unit 4: Add dashboard client, routes, navigation, form, event list, history, built-in phases, and the leaderboard spacing fix.
- [ ] Unit 5: Add service, control, dashboard, and browser coverage; update docs; run all requested checks.
- [ ] Before every commit, run deslop and inspect the staged diff.
- [ ] No independent review subagent: skip because the user prohibited spawning subagents.

## Phase A framing

Definition of done: both database tables and only their indexes/checks appear in the generated migration; pure scheduling helpers and service behavior are tested; control and dashboard boundaries enforce the requested permissions and validation; the dashboard supports the complete event lifecycle and history; existing prayer phases remain independent; the browser check works at 1200px and 380px; all requested package and root checks pass; and each verified ordered unit has a conventional commit.

Scope: five user-ordered units spanning database schema and migrations, bot service and tests, shared schemas and control API, dashboard server and browser UI, docs and full verification. High rigor because the work touches persistence, concurrent playback, authorization, and cross-service contracts.

Grounding: branch `feat/scheduled-events` is at `af735664e19cafac61f5adc76ab9a328c33423b8`, matching the requested base. No repository-level `AGENTS.md` or `.agents/playbooks` were found. The user explicitly forbids spawning subagents, so cross-model review and parallel architect exploration are unavailable.

## Phase B workflow

1. Establish pre-change test/build baseline and map the existing service, control, dashboard, and migration patterns.
2. Add the schema and pure rule unit, generate and inspect its migration, run targeted checks, then commit.
3. Add service persistence and scheduling, test run lifecycle and exclusion, then commit.
4. Add control API authorization, validation, feature behavior, and audit tests, then commit.
5. Add dashboard routes and UI, run server tests and browser checks, then commit.
6. Add docs and remaining tests, run every requested package and root check, inspect the final diff and migration, then commit.
