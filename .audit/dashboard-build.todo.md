# Dashboard build

## Phase A: Frame

- [x] Definition of done: app code and named server checks implemented, smoke requests recorded, and commits created on `feat/admin-dashboard`.
- [x] Scope: one Fastify app, static UI views, auth/session, control client, test suite, root wiring, container, compose, env example, docs.
- [x] Ground blockers in existing router/config/deploy conventions. The new guild/features control routes are not available in this branch yet. Podman and the in-app browser are unavailable in this environment.

## Phase B: Design the workflow

- [x] Frame/security: parse config and set up request boundary, session and CSRF.
- [x] Control API: central client and whitelisted browser routes; verify mapping tests.
- [ ] UI: accessible shell, hash router, and guild-aware views are implemented. Rendered checks at 360px and 1440px are not verified because the browser is disconnected.
- [x] Delivery: deployment, docs, full checks, smoke requests, and focused commits.
- [x] Blocking first steps: read the contract and inspect router, config, and deployment conventions before implementation.
- [x] Independent workstreams: n/a, one owner and a shared new app plus root wiring.
- [x] Shared mutable state: root package manifest and lockfile are written serially by this owner.
- [x] Smallest safe decomposition: one owner because API, UI, tests, and deployment share contract and root files.

## Phase C: Run the loop

- [x] Each unit is an experiment. State the hypothesis, make the smallest change, measure against the predicate on the real artifact, keep it if it advanced, revert it if it didn't.
- [x] Verify by inspecting the artifact, never a self-report. When something passes too easily, suspect the observation method before the system.
- [x] A verdict is VERIFIED, NOT VERIFIED, or INCONCLUSIVE. Inconclusive is not a pass. Don't hide a negative.

## Phase D: Keep the audit trail

- [x] Log the run via the show-me-your-work skill.

## Phase E: Verify and hand back

- [x] Check the server, browser-facing API, static asset, tests, and build against the Phase A predicate.
- [ ] Check rendered views and the container image against the Phase A predicate. Skip: no in-app browser or Podman binary is available.
- [x] Encode any recurring correction as a gate, a lint rule, a check, or a script.
- [ ] BLOCKED: rendered UI review at 360px and 1440px. The browser tool reported no connected desktop browser, and no local browser binary is installed.
- [ ] BLOCKED: container build and Podman Compose validation. Podman is unavailable; the compose file passed a YAML parse only.
- [ ] BLOCKED: independent review. This subagent cannot spawn another reviewer.
- [x] Deferred the four integration findings reported by the parent. Do not change escaped guild names, config key labels, role ID formatting, or empty usage chips on this branch.

## Feature workflow

- [x] 1. `how` over the affected subsystem.
- [ ] 2. `architect` for parallel design exploration. Skip: user contract specifies the app structure and browser/API behavior; this session cannot spawn more agents.
- [x] 3. Write the throughput checkpoint as four todo items. A dimension that genuinely does not apply (single file, no fan-out) keeps its item with `n/a: <reason>` rather than being dropped.
- [x] 4. Delegate code-writing to a subagent using your configured feature model (default in poteto-mode's Models section) with a specific scope (file paths, named data shape and its organizing structure per **principle-model-the-domain**, a state machine over scattered booleans, a table/registry over branching, a typed model over repeated shape assumptions, chosen before the delegate writes logic, and success criteria). Pick each subagent's reasoning level for the job, per the Subagents section. When the implementation admits multiple valid shapes (error handling, abstraction layer, test structure), delegate via the **arena** skill instead so the runners surface the alternatives and the cross-judge guards the pick. Mandatory: no skip-with-reason escape, and Laziness Protocol does not override it (the gain is review separation, not lines saved). A subagent forbidden to spawn satisfies this by owning the diff directly with the same review separation. No "standing by" reply that waits on a nested agent. **Give every file-writing delegate its own worktree** (spawn it with `isolation: "worktree"`, or hand it an exclusive branch), and do not write files or run a suite in a worktree a delegate still holds. On Claude Code, `isolation: "worktree"` branches from the remote default branch unless the `worktree.baseRef` setting is "head". When the delegate builds on commits the default branch lacks, commit them, create its worktree with `git worktree add <path> -b <delegate-branch> HEAD`, and name that base commit in the brief. Fencing a file in the brief's prose is not a lock (**principle-separate-before-serializing-shared-state**). Comments per **Comments**. Surgical edits, re-ground against the source for upstream-derived files. Port shared-primitive improvements to all consumers and verify each. Commit liberally.
- [ ] 5. Verify on the matching surface. "Inconclusive" or wrong-surface is not a pass. Flag it. Skip: server and API checks passed, but the rendered UI could not be inspected.
- [x] 6. Rebase into small, ordered commits. Stack follow-ups.
- [x] 7. If the design is contested, `interrogate` before shipping. Skip: the user supplied the layout, visual direction, and interactions in the build contract.
- [ ] 8. Run **Opening a PR**. Skip: user requested commits only and explicitly said do not push.
