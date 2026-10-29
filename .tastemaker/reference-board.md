# Reference board

Created: 2026-10-29
Mode: Operate
Design read: self-hosted Discord bot dashboard for one operator managing several servers, with a dark technical interface and status-first data views.
Dials: variance 4, motion 2, density 7, art direction 5
Sourcing: viewed via search and fetch on 2026-10-29

## Quality bar

- [Linear UI redesign](https://linear.app/now/how-we-redesigned-the-linear-ui), viewed 2026-10-29. The sidebar, tabs, headers, and panels reduce visual noise while keeping navigation dense.
- [Grafana organization preferences](https://grafana.com/docs/grafana/latest/administration/organization-preferences/), viewed 2026-10-29. Settings explain which scope owns a preference and how the navigation reaches it.
- [Discord Developer Platform docs](https://docs.discord.com/developers/intro), viewed 2026-10-29. The entry page groups information by builder task and uses the Discord product context without pretending to be the bot's own admin UI.

## Borrow

- Palette and material: the brief's dark operator tool, with near-black navigation and one teal action color. Semantic green, amber, and red appear only for service and error states.
- Type and hierarchy: Linear's neutral app chrome and restrained text hierarchy. System fonts keep the dashboard local and avoid a font network dependency.
- Layout and composition: Linear's persistent left rail and compact headers, paired with Grafana's explicit configuration scope. The overview gives readiness priority over secondary metrics.
- Motion and interaction: brief fades for view changes and skeletons for initial loading. High-frequency toggles update immediately and do not animate the surrounding rows.
- Asset language: one local Carbon icon family and a geometric signal mark. The login panel uses a CSS-built status motif because this app has no illustrative content to source.

## Avoid

- Generic admin template cards, marketing headlines, decorative gradients, emoji, and a separate icon style per view.
- Copying a competitor's layout or implying that this dashboard is Discord's official administration surface.

## Direction contract

- Thesis: make readiness, server scope, and bot controls visible without exposing the internal control API.
- First viewport: persistent rail, a guild-aware topbar, and a status-first overview with uptime, gateway latency, and health checks.
- System: Fastify serves local HTML, CSS, JavaScript, and SVGs. The custom dark palette uses a teal accent and explicit status colors.
- Risk: a dense layout can become cramped on a phone, so the rail collapses to icon navigation and tables scroll within their own panels.
