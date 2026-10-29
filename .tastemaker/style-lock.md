# Style lock: Siela admin dashboard

Established: 2026-10-29. Source: user-specified dark, quiet, information-dense operator interface, with a generated technical palette.

## Palette

- Background: `#060c0e` for the workspace.
- Surface: `#10171a` for panels. Raised surfaces use `#141e22`.
- Primary: `#19819b` for solid actions and active switch fills.
- Accent: `#62d0d2` for links, active indicators, and focus rings.
- Text primary: `#e5f5fa`, contrast vs background 17.60:1 and vs surface 16.19:1.
- Text muted: `#91a0a6`, contrast vs background 7.30:1 and vs surface 6.71:1.
- Text quiet: `#76888f`, contrast vs background 5.33:1 and vs surface 4.91:1.
- Button label color: white, contrast vs primary 4.51:1.
- Dark mode: one locked dark mode. No runtime theme switch.
- Status colors: ok `#58d5ab`, warn `#e9b45c`, danger `#f07378`. Each status also has a text label.

## Color contract

The palette follows the contrast results printed by `generate_palette.py --mood technical --mode dark --seed 20261029`, plus the measured foregrounds used for controls.

| Foreground on background | Floor | Result |
| --- | ---: | ---: |
| Primary text on background or surface | 4.5:1 | 17.60:1 on background, 16.19:1 on surface |
| Muted text on background or surface | 4.5:1 | 7.30:1 on background, 6.71:1 on surface |
| Quiet text on background or surface | 4.5:1 | 5.33:1 on background, 4.91:1 on surface |
| White button text on primary | 4.5:1 | 4.51:1 |
| Primary fill against the page | 3:1 | 4.36:1 |
| Accent text or focus ring on background | 3:1 | 10.76:1 |
| Ok, warn, and danger text on background | 4.5:1 | 10.80:1, 10.45:1, and 6.96:1 |
| Strong control border on input or surface | 3:1 | `#5d747c` measures at least 3.31:1 against its darkest control surface |

Decorative hairlines use `#233238` and do not carry state. The `#19819b` primary color is not used for text on the page because it measures 4.36:1 against the background. The brighter accent color carries links and focus instead.

## Typography

- Display and headings: system UI sans stack with system fallbacks. No web font requests.
- Body: same system UI stack.
- Data, IDs, and short technical labels: system monospace stack.
- Scale: browser root at 100%, body at 0.875rem, captions and short labels at 0.75rem or larger, headings use a compact responsive scale, and data uses tabular numerals.

## Shape language

- Corner radius: 5px controls, 9px panels, and 13px for the overview status panel.
- Shadow depth: flat panels. The dialog has a single dark shadow for separation.
- Border usage: dark hairlines separate panels; brighter borders mark controls and focus.

## Density and spacing

- Base unit: 4px.
- Compact rows: 38px navigation controls, 42px desktop buttons, and 24px switches.
- Content panels: 14px to 20px internal padding, with 12px to 18px between peer panels.
- Overall density: dense, information-heavy.
- Section separation: consistent hairline borders.

## Reference intelligence

- Reference board: `.tastemaker/reference-board.md`, viewed sources.
- Design read: self-hosted Discord bot operator dashboard, mode Operate, quiet technical app shell.
- Dials: variance 4, motion 2, density 7, art direction 5.
- Foundation: custom CSS and browser JavaScript, no framework or CDN. Fastify, Zod, and tsup follow the repository's existing stack.
- Quality bar: Linear app chrome, Grafana settings scope, and Discord's task grouping.
- Direction contract: readiness and server scope lead; the browser never sees the control token; mobile navigation opens from a topbar hamburger drawer.
- Anti-references: generic admin cards, unnecessary gradients, emoji icons, and unscoped proxy routes.

## Taste memory

- Profile priors used: none. No profile or existing project lock was present.
- Decision log: `.tastemaker/decisions.log`.
- Last resolved decisions: none.
- Pending review: keep or revise the status-first overview density and teal accent.
- Profile promotion: none. No user preference has been resolved for reuse.
- Memory precedence note: the current build contract overrides generated defaults.

## Navigation chrome

- Sidebar background: `--rail`. Content area background: `--bg`.
- Active navigation: tinted row and a 2px teal edge.
- Inactive hover: subtle surface shift, weaker than the active state.
- Header: the page heading carries the view label, the topbar carries the bot status pill, and the rail header carries the server picker.
- Shell density: 42px navigation rows in a 232px labeled rail, a 58px icon rail when collapsed, and the same labeled rows in a drawer below 700px.
- Rail context: the header is the server picker with the selected server's Discord image and name; the chevron collapses the labels.

## Mood descriptors

Quiet, precise, technical.

## Assets

- Anchor asset: `apps/dashboard/public/mark.svg`, a geometric signal mark built from vector shapes.
- Asset style: local Carbon icons, teal monochrome; no remote font or icon dependencies. Korean text falls back to the bundled Pretendard Regular subset.
- Illustration and photography split: none. This app presents live operational data rather than editorial content.
- Logo: `apps/dashboard/public/mark.svg`, created for this new surface, paired with the system UI wordmark.

## Motion

- Feel: brief and restrained.
- Curves: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`.
- Durations: 120ms control feedback, 190ms view entrance.
- Entrance: 7px upward offset and opacity fade for a view change.
- Screen tracks: app-shell panel transition and skeleton loading only.
- Frequency rules: feature switches do not animate their row; no autoplay or timed content.
- Reduced motion: animation and transitions reduce to 0.01ms.
- Verified by: Tastemaker `audit_motion.py` passed on 2026-10-29. Browser motion inspection is not verified because the in-app browser was disconnected.

## Do not

- Do not add external fonts, third-party scripts, a light theme, a second accent family, decorative emoji, or a generic proxy route.
