# Candidate: Quiet

Branch `ui/minimal-quiet`, worktree `/home/super/siela-worktrees/ui-quiet`.

## Design thesis

The dashboard should read like an operator instrument: flat surfaces separated by rules, one accent reserved for the thing you can act on, and rows tight enough to scan in a glance. Everything that only restated something already on screen is gone, so what remains is status, controls, and data. Motion appears only when a state changed and the change would otherwise be easy to miss: a toggle landed, a count moved, a save became available, a toast is leaving.

## Bloat cuts

1. **Shell and login.** Removed the duplicated topbar page title, the topbar context dot, the "Server" label beside the picker, the "CONTROL ROOM" sublabels, the "SELF-HOSTED CONTROL" footer text, the login aside with its signal decoration and "BOT SYSTEMS / UNDER YOUR CONTROL" copy, the "PRIVATE INSTANCE" eyebrow, and the "↗" glyph on Continue. The footer now carries the version only, right-aligned; login is a single centered column.
2. **Overview.** Removed the "LIVE STATUS" chip, the gradient lead card with its "BOT READY" eyebrow, the version line, the twenty-bar signal graphic, metric icons, and filler metric notes ("Across connected servers", "Active temporary rooms"). The separate Service health box and Recent actions box became two rule-separated columns. What is left: one status line (state, uptime, gateway), three inline metrics, then health and recent actions.
3. **Servers.** Removed the Owner ID column, the separate "Open server" column, the "CONNECTED GUILDS" topline, and the "03 TOTAL" counter that repeated the page summary. The server name is now the link, so one row does one job; copy-ID stays.
4. **Features.** Removed command chips from every row, the per-category "02 / 02 ON" counters, the left status bars, and the always-on "Requires …" hints. Commands moved to a native `title` tooltip. A dependency hint now renders only when the dependency is actually off ("Needs Music playback") and updates live when it changes.
5. **Settings.** Five bordered panels became one flat list separated by horizontal rules. Removed the uppercase per-section eyebrow that repeated the section title, and the full-width save row. Each section has a compact Save button that stays disabled until the form is dirty.
6. **Audit, Commands, Music.** Audit lost the "control" source repeated under every action and the "LAST 50" counter. Commands lost boxed chips and tag pills; it is now a flat table with quiet category labels, and "Not set" replaces the em dash for empty usage. Music lost the decorative spinning disc and its two panel boxes; the player and queue are split by a rule, and the status order was fixed so `paused` reads "Paused" instead of "Playing".

## Micro-interactions

- **Feature count bump.** The enabled count re-renders with a 160 ms opacity/translate animation only when the number actually changes. It confirms the toggle without a separate toast on every flip.
- **Feature row confirm.** A toggled row flashes a 180 ms opacity overlay (0.09 to 0) after the server confirms, so the optimistic state resolves visibly.
- **Settings dirty state.** Editing any field or switch in a section enables its Save button and fades in a 6 px accent dot next to it (120 ms). The dot disappears on save, which is the only signal that the section is clean again.
- **Toast enter and exit.** Toasts enter with a 160 ms fade/rise and leave with a 140 ms fade/4 px drop instead of disappearing instantly, so a dismissed Undo does not vanish mid-read.
- **Status pill crossfade.** When the bot status text changes (Ready, Offline, Loading), the pill fades once (160 ms) rather than swapping glyphs silently.
- **Copy ID.** Copying an ID turns the button and its "Copy" hint to the ok color and shows the hint; it reverts after the copy state clears. It is the only place the success color is used outside status.
- **Dependency hint update.** Turning a dependency off inserts the hint under the dependent feature in place, and turning it back on removes it, with no re-render of the list.

All motion is transform/opacity only, uses exact transition properties, `--ease-out` (`cubic-bezier(0.23, 1, 0.32, 1)`), 120–180 ms for UI feedback. Hover-only motion sits behind `@media (hover: hover) and (pointer: fine)`. `prefers-reduced-motion` collapses animation and transition durations to 0.01 ms and substitutes a 120 ms linear fade for view entry.

## Rejected

- **Accordion settings.** Collapsing five sections into one-open-at-a-time hides values the operator came to read and adds clicks to every edit. Rules do the grouping job without the interaction cost.
- **Staggered row animation on search.** Search fires per keystroke, so a per-row stagger would animate on every keypress, including held keys. That is motion on a keyboard-repeated action, which the brief rules out.
- **Keeping the spinning disc and signal bars.** They are decorative, not state: the status line already says whether audio is playing. Removing them also removes an always-on animation from a view people leave open.
- **Landing-page centered empty states.** A centered hero block in an operator tool reads as marketing. Empty states are now left-aligned headings with a short line of copy, plus a retry button only where retry is meaningful.
- **Horizontal scroll for mobile tables.** Rejected in favour of stacked rows with `data-label` pseudo-labels, and a two-column grid for Commands so the command name and category share a line at 320 px.

## Screenshots

Before: `/tmp/shots-quiet/before-1440-<view>.png`, `/tmp/shots-quiet/before-380-<view>.png`, plus `before-1440-login.png` and `before-380-login.png`.
After: `/tmp/shots-quiet/after-1440-<view>.png`, `/tmp/shots-quiet/after-380-<view>.png`, `/tmp/shots-quiet/after-320-<view>.png`.

Views: `overview`, `servers`, `features`, `music`, `settings`, `audit`, `commands`, plus `login` at 1440/380 and `after-380-commands-empty.png` / `after-320-commands-empty.png`.
Interaction states: `/tmp/shots-quiet/ix-copy.png`, `ix-feature-toggle.png`, `ix-settings-dirty.png`, `ix-settings-saved.png`, `ix-music-paused.png`, `ix-commands-filter.png`, `ix-help.png`.

Screenshots live outside the repo and are not committed.

## Commands and results

Run from the worktree root, with the mock API on port 4101 and the dashboard on 4111.

| Command | Result |
| --- | --- |
| `bun install --frozen-lockfile` | pass |
| `bun run --cwd apps/dashboard typecheck` | pass, no output from `tsc --noEmit` |
| `bun run --cwd apps/dashboard test` | pass, 4 files, 16 tests |
| `bun run --cwd apps/dashboard build` | pass, `dist/index.js` 18.21 KB |
| `bun run typecheck` (root) | pass, all seven workspace typechecks |

Playwright interaction pass (login, copy ID, feature toggle with Undo, settings dirty/save, music pause/resume, command search 20 to 9 rows, `g` chord, `?` help): zero console errors and zero page errors.

## Known gaps

- The repo has server-side tests only; the UI changes are covered by the Playwright pass above, not by committed DOM tests.
- Screenshot review covered 1440, 380, and 320 px. Widths between 700 and 1050 px rely on the same grid rules but were not shot individually.
- The mock control API supplies synthetic guilds, features, and audit history; no real Discord data was exercised.
