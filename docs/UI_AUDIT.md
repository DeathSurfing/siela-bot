# Siela Bot — UI / UX Audit

Date: 2026-10-22

Scope: every user-facing Discord surface in `apps/bot/src/commands` and
`apps/bot/src/features`, excluding the HTTP control/health APIs.

Method:

- Read every command and feature that replies, edits, sends components, or opens a modal.
- Inventory screens, interaction states, and copy.
- Compare patterns across features.
- Review Discord Components V2 constraints and current open-source bot patterns.

---

## 1. Executive summary

The bot is functionally complete, but the UI reads like a collection of
features added at different times rather than one product.

The main problems are:

1. **Inconsistent visual language.** Some screens use embeds with colored
   sidebars, some use plain text, some use full component rows, and some use
   plain ephemeral one-liners.
2. **Too much visual weight for small actions.** Many confirmations are
   embeds with titles, fields, footers, timestamps, or multiple emojis for
   actions like "Paused." or "Queue cleared."
3. **Music controls are over-packed.** The now-playing card exposes eight
   controls in two rows, including seek, skip, stop, shuffle, loop, and
   filters. That is a lot of decision surface for a voice bot.
4. **Temp VC panel is dense and exposes destructive actions too early.**
   Four buttons, two member selects, a multi-line description, three status
   fields, and an internal footer marker are all visible at once.
5. **Help is still a legacy embed.** It does not use the native-feeling
   Components V2 layout that the bot's own README implies, and it offers no
   search or command discovery beyond a category select.
6. **No shared state components.** Loading, empty, success, and error states
   are implemented ad hoc and copy varies from feature to feature.
7. **No consistent destructive-action policy.** Temp VC delete has a
   confirmation; `privacy delete`, `clear`, `clearqueue`, `stop`,
   `disconnect`, `prefix reset`, and `confession delete` do not.
8. **Mobile density is high.** Inline embed fields stack vertically on
   mobile, and the Temp VC panel plus music controls consume a large amount
   of vertical space.

Recommended direction:

- Build a small shared UI kit.
- Use **Components V2** for the primary surfaces: help, now-playing, queue,
  Temp VC panel, and admin config cards.
- Keep ordinary success/error replies as short ephemeral text.
- Use one accent color for normal cards, one success color, one danger color.
- Remove repeated footers, timestamps, and redundant fields.
- Prefer progressive disclosure: primary actions first, secondary actions in
  a select menu or modal.

---

## 2. Screen inventory

| Area | Screens / surfaces | Primary files |
|---|---|---|
| Help | help landing, category list, command detail | `features/help.ts`, `commands/utility/help.ts` |
| Music | play loading/result, now playing, queue, controls, filter select, music config | `commands/music/music.ts`, `features/music-ui.ts`, `commands/admin/musicconfig.ts` |
| Temp VC | setup/config, join-to-create, control panel, lock/rename/limit/delete, kick/transfer selects, `vc info` | `features/tempvc.ts`, `commands/voice/vc.ts`, `commands/admin/tempvc.ts`, `commands/admin/jointocreate.ts`, `bot.ts` |
| Social | slap/kiss/hug/chodu/wuzu, social stats, social top, opt in/out, lovecalc, bias | `commands/social/social.ts`, `love.ts`, `bias.ts` |
| Friendship | friendship card, friendship leaderboard | `commands/social/friendship.ts` |
| Family | marry/adopt consent, divorce, runaway, family tree image/fallback | `commands/social/family.ts` |
| Confession | anonymous post, admin channel/delete/status | `commands/social/confess.ts`, `commands/admin/confession.ts`, `features/confession.ts` |
| Delulu | generated scenario card | `commands/social/delulu.ts` |
| Birthday | set/show/clear/channel, automatic wish | `commands/utility/birthday.ts`, `features/birthday.ts` |
| Activity | member activity card, activity leaderboard | `commands/utility/activity.ts` |
| Utility | ping/status, privacy info/delete | `commands/utility/ping.ts`, `commands/utility/privacy.ts` |
| Admin | config overview, welcome, autorole, tempvc, join-to-create, music config, prefix, confession | `commands/admin/*` |
| Welcome | join/goodbye messages and welcome card | `features/welcome.ts`, `features/welcomeCard.ts` |
| Global states | deferred loading, errors, empty states, cooldowns, destructive confirmations | `framework/context.ts`, `bot.ts`, command implementations |

---

## 3. Screen-by-screen findings

Severity: **P0** = blocks clarity or safe use; **P1** = visible friction;
**P2** = polish.

### 3.1 Help

Current:

- Legacy embed with author (`Siela Bot • version`), footer (`Prefix ! • hybrid
  commands`), timestamp, title, description, inline category counts.
- Category select plus a separate "Close" button row.
- Command detail adds usage, category, cooldown, access, aliases, examples.

Issues:

- **P1 — Not native / not minimal.** The colored embed + author + footer +
  timestamp is the classic "marketing bot" look.
- **P1 — Close is a whole row for one secondary action.** It adds vertical
  space and makes the select feel like a form.
- **P1 — No search.** With 55 commands, category browsing plus
  `help <command>` is slow on mobile.
- **P2 — Version and timestamp on every help view are not useful.**
- **P2 — Command names are shown with both slash and usage; the list becomes
  wide and wraps on mobile.**

Recommendation:

- Convert the landing view to Components V2:
  - Container with one accent color.
  - Header: bot name + short one-line purpose.
  - Category select.
  - "Search commands" button that opens a modal with a text input (or a
    select of matching commands).
  - Compact category rows: emoji + category + count + one-line description.
- Remove author/footer/timestamp from help.
- Put "Close" as a small secondary button in the same action row as search.
- In command detail, show usage and one example, not every alias/field.
- Keep help ephemeral.

### 3.2 Music — now playing / controls

Current:

- Embed with title "Now playing", track line, position/volume/loop fields,
  "Up next" field, optional artwork thumbnail.
- Two action rows:
  - Pause/Resume, -10s, +10s, Skip, Stop.
  - Shuffle, Loop, Filters.
- Buttons use labels plus emojis; styles mix Secondary, Primary, Success,
  Danger.

Issues:

- **P0 — Eight controls is too many.** It dominates the message, especially
  on mobile.
- **P1 — Stop is next to skip and uses danger styling.** Accidental
  disconnects are easy.
- **P1 — Seek is represented by two buttons but no visible progress bar.**
  Users cannot see where -10/+10 will land.
- **P1 — Loop button label changes (`Loop: off/track/queue`) and color
  changes; it is hard to scan.**
- **P2 — "Up next" is useful; volume and loop could be secondary metadata.**

Recommendation:

- One V2 music card:
  - Section with artwork thumbnail and track title/artist.
  - Progress bar + timestamps.
  - One action row: Pause/Resume, Skip, Stop (or a "Stop" secondary with
    confirmation), Queue.
  - A "More" select for seek, shuffle, loop, filters, volume.
- Keep Stop out of the primary row or require a confirmation for disconnect.
- Use one accent color; reserve red for the confirmation state only.
- Update the same now-playing message for pause/skip/loop/filter changes
  instead of sending one-line ephemeral confirmations where possible.

### 3.3 Music — play result and queue

Current:

- `play` replies with "🔎 Loading…", then edits to "Added to queue" or
  "Playlist added" with track line and controls.
- Queue is an embed with up to 10 tracks, footer packed with upcoming count,
  total duration, page, volume, loop.
- No pagination buttons; page must be re-typed.

Issues:

- **P1 — "Added to queue" is misleading when the track starts immediately.**
- **P1 — Queue footer is a metadata dump.** Five facts in tiny text.
- **P1 — Pagination is command-only**, which is poor on mobile and breaks the
  "controls on the message" pattern.
- **P2 — No empty-state action** such as "Play something".

Recommendation:

- Distinguish "Playing now" vs "Queued at #N".
- Queue card: current track section, 5–10 upcoming rows, total duration,
  page indicator, Previous/Next buttons.
- Move volume/loop to a `More` select or omit from queue.
- Add a single empty state: "Queue is empty — use `/play`."

### 3.4 Music — command confirmations

Current:

- Many one-line ephemeral replies: "Paused.", "Resumed.", "Skipped.",
  "Stopped and cleared.", "Queue shuffled.", "Track moved.", "Jumped.",
  "Disconnected.", "Filter preset: ...", "Volume set to ...".

Issues:

- **P2 — Copy is inconsistent in tone and detail.** Some include values,
  some do not.
- **P2 — Confirmations do not update the now-playing card**, so the visible
  player can become stale.
- **P2 — "Jumped." and "Skipped." are ambiguous.**

Recommendation:

- Standardize ephemeral confirmations to verb + object:
  - "Skipped 2 tracks."
  - "Moved track to #1."
  - "Volume set to 80%."
- Where a now-playing message exists, update it instead of sending a second
  message.

### 3.5 Temp VC — control panel

Current:

- Embed with title "Temporary VC controls", multi-line description, status /
  user limit / in-channel fields, internal footer marker.
- Four buttons: Lock/Unlock, Rename, Limit, Delete VC.
- Two user selects: kick, transfer ownership.
- Pinned in the channel's text chat.

Issues:

- **P0 — Destructive Delete is a primary-row button next to rename/limit.**
- **P0 — Two member select menus always visible** take two full rows and
  invite accidental taps.
- **P1 — Description is verbose and explains the UI instead of letting the UI
  explain itself.**
- **P1 — Internal footer marker is visible to users.**
- **P1 — Status uses emoji + text; "User limit" and "In channel" are not
  actionable.**
- **P2 — No visual indication that the panel is refreshed/pinned.**

Recommendation:

- V2 container:
  - Header: channel name + owner mention.
  - One compact status line: `Open • 3/10 • 4 members`.
  - Primary row: Lock/Unlock, Rename, Limit.
  - One "Manage" select: Kick, Transfer, Delete.
- Delete opens a confirmation modal/button view, not an immediate action.
- Remove the internal footer marker from visible text (store marker in a
  hidden field or use a button custom ID / message pin instead).
- Show member selects only after choosing Kick/Transfer.

### 3.6 Temp VC — modals and `vc` command

Current:

- Rename/limit modals use `TextInputBuilder` in action rows.
- `vc` command sends generic ephemeral text: "Temporary VC **lock**
  complete.", "Temporary VC **permit** applied to X."
- `vc info` uses an embed with Owner/Locked/User limit/Created fields.

Issues:

- **P1 — Generic completion text reads like a debug log.**
- **P1 — `vc info` uses "yes/no" and "x ago" instead of Discord timestamps.**
- **P2 — Modals use older action-row construction instead of `LabelBuilder`.**

Recommendation:

- Use `LabelBuilder` for new modals (Discord's newer modal pattern).
- Standardize copy: "Locked the channel.", "Allowed @user.", "Transferred
  ownership to @user."
- `vc info` should use `<t:...:R>` for created time and explicit
  "Locked/Open" labels.

### 3.7 Social interactions

Current:

- Embed with description and optional GIF; count is embedded in the sentence.
- No title, color `COLORS.social`.
- Stats and leaderboard are separate embeds.

Issues:

- **P2 — Interaction result is visually fine, but all five commands produce
  near-identical cards.**
- **P2 — Social stats is a wall of five lines with bold labels.**
- **P2 — Social leaderboard footer explains an implementation detail.**

Recommendation:

- Keep the GIF card, but reduce the sentence to one line plus count.
- Social stats: two compact columns (given/received) or a select to switch
  interaction kind.
- Remove the leaderboard footer; use a short subtext line only if needed.

### 3.8 Lovecalc, bias, friendship

Current:

- Lovecalc: title with score, names, bar, title, message, footer.
- Bias: title + two inline fields.
- Friendship: title with tier emoji, description, four fields including a
  duplicate tier field.

Issues:

- **P2 — Friendship repeats tier in title and field.**
- **P2 — Lovecalc footer is redundant ("permanent for this pair").**
- **P2 — Bias is fine but could be one line: Bias / Wrecker.**

Recommendation:

- Friendship: title + progress bar + XP + time together; remove duplicate
  tier field.
- Lovecalc: remove footer; use score as the title.
- Bias: keep minimal, no extra emojis.

### 3.9 Family

Current:

- Consent is a plain content message with Approve/Reject buttons and a
  15-second timer.
- Approve/reject/timeout messages are plain text.
- Success messages are embeds with emoji.
- Family tree is an image rendered through Mermaid.ink, with a Mermaid code
  fallback.

Issues:

- **P0 — Consent is visually inconsistent with the rest of the bot and does
  not show the remaining time.**
- **P1 — Approve/Reject buttons are not disabled after a decision; the
  message is edited to plain text.**
- **P1 — Family tree image has no title/legend for marriage vs parent edges.**
- **P2 — Success messages use emoji instead of a consistent status style.**

Recommendation:

- Consent card: target mention, action, relative timestamp
  (`<t:...:R>`), Approve/Reject, disable buttons and replace with outcome.
- Tree: image with a short caption + legend; keep code fallback only when
  image rendering fails.
- Success: use the shared success state, not a separate embed style.

### 3.10 Confession

Current:

- Wall post: embed `Confession #N`, content, footer "Anonymous confession",
  timestamp.
- Admin status/delete are plain ephemeral text.

Issues:

- **P2 — "Anonymous confession" footer is redundant with the wall context.**
- **P2 — Admin config is one-line text; no status card.**
- **P1 — `confession delete` is irreversible with no confirmation.**

Recommendation:

- Keep the wall post minimal: `Confession #N` + content + relative time.
- Admin status: compact card with channel + count + last post.
- Add a confirm step for deletion.

### 3.11 Delulu

Current:

- Embed with title `✨ Delulu: X notices you` and generated text.

Issues:

- **P2 — Fine, but the sparkle emoji and title are a little heavy for a
  text-only result.**
- **P1 — No loading state beyond a generic defer; generation can take a
  while on CPU.**

Recommendation:

- Use a small V2 card or a simple embed without emoji.
- Show a transient "Writing…" state if latency remains high.

### 3.12 Birthday, activity, ping, privacy

Current:

- Birthday: title emoji, Date/Age fields.
- Activity: title, five inline fields.
- Activity leaderboard: plain numbered lines.
- Ping: five fields and timestamp.
- Privacy: two paragraphs and a command hint.

Issues:

- **P2 — Birthday and activity use `yes/no`/plain numbers where a compact
  stat row would read better.**
- **P1 — Activity leaderboard has no medals/formatting and fetches every
  member individually.**
- **P2 — Ping is a status dump; not all fields are equally important.**
- **P2 — Privacy is a wall of text.**

Recommendation:

- Use one shared stat-card pattern.
- Activity leaderboard: medals for top 3, right-aligned values, pagination.
- Ping: Gateway / Database / Music as a single status line; uptime as
  subtext.
- Privacy: bullet list with a single destructive action button.

### 3.13 Admin config screens

Current:

- Welcome, autorole, tempvc, join-to-create, musicconfig, prefix, confession.
- Mostly embeds with 5–10 fields; many use lowercase `yes/no`, `not set`.
- Mutations return one-line ephemeral text.

Issues:

- **P0 — Admin surfaces are read-only embeds; every change requires
  remembering a subcommand.**
- **P1 — Inconsistent field labels and casing across configs.**
- **P1 — Some config shows publicly (e.g. `tempvc show`, `config`) while
  mutations are ephemeral.**
- **P2 — Warnings are appended to success messages instead of shown as a
  separate callout.**

Recommendation:

- V2 admin dashboard pattern:
  - Section: setting name + current value + short description.
  - Action row: Edit / Reset / Status.
  - Modal or select for editing.
- Standardize labels and sentence case.
- Keep config views ephemeral.
- Show warnings as a separate callout row/container, not appended text.

### 3.14 Welcome

Current:

- Image card + embed for join, optional DM and goodbye.
- Preview command.

Issues:

- **P2 — Welcome preview is one of the better surfaces; the image does most
  of the work.**
- **P2 — Duplicate embed/data between preview and real send.**

Recommendation:

- Keep it, but share a single payload builder between preview and send.
- Use V2 container if image + text should feel native; otherwise keep embed.

---

## 4. Cross-cutting issues

### 4.1 Color and emoji

- Colors are feature-based (`COLORS.music`, `COLORS.social`,
  `COLORS.voice`, `COLORS.success`, `COLORS.primary`). This creates a
  rainbow across the bot.
- Emojis are used as decoration in titles, buttons, and status text.
- Research recommendation: 2–3 accent colors max, emojis for meaning not
  decoration.

Proposed palette:

- **Primary** — one brand accent for normal cards.
- **Success** — confirmations.
- **Danger** — destructive actions and errors.
- Remove per-feature colors from message sidebars; use feature icons in
  headings instead.

### 4.2 Copy

- Mixed casing: "yes/no", "on/off", "not set", "Temporary VC **lock**
  complete".
- Generic errors: "That action failed.", "Something went wrong."
- Redundant footers: "This result is permanent", "Anonymous confession",
  "Counts are pair-based...".

Proposed copy rules:

- Sentence case.
- Verb-first confirmations.
- No implementation details in UI.
- One idea per line.
- No footer unless it adds time-sensitive context.

### 4.3 State handling

| State | Current | Proposed |
|---|---|---|
| Loading | inconsistent; only `play` says Loading | shared loading component / defer + short status |
| Success | plain text or embed | short ephemeral success, or update existing card |
| Error | plain ephemeral + request ID for unknown | shared error card with action hint |
| Empty | plain text | shared empty state with next action |
| Destructive | inconsistent | confirmation with cancel + destructive button |
| Expired | buttons sometimes remain | disable/replace components after timeout |

### 4.4 Accessibility and mobile

- Inline embed fields stack on mobile; keep max 2 inline fields.
- Member selects and 8 music buttons consume vertical space.
- Emoji-only meaning is risky; every button already has a label, keep it
  that way.
- Use relative timestamps for time-sensitive UI.
- Test at mobile width, not just desktop.

### 4.5 Performance and UX latency

- Leaderboards fetch every member individually; use cached display names
  and batch resolution.
- Long-running operations should defer and show progress.
- Avoid duplicate API calls for `ctx.reply` + `ctx.edit`; reuse the returned
  message.

---

## 5. Research notes

### Discord Components V2

- Components V2 messages must use `MessageFlags.IsComponentsV2`.
- `content` and `embeds` cannot be used alongside V2 components; everything
  becomes components.
- Limits: up to 40 components; keep text across TextDisplays around
  3,000–3,500 characters for readability.
- Use Containers for grouping, Separators for rhythm, Sections for
  text/thumbnail pairs, MediaGallery for images, File for attachments.
- Use `LabelBuilder` for new modals.
- Test on desktop and mobile; layout differences are significant.

Sources:
- [Discord Components overview](https://discord.com/developers/docs/components/overview)
- [Components V2 best practices](https://github.com/Ddeveloper-sr/Components-v2-guide/blob/main/best-practices/README.md)
- [discord.js Components V2 examples](https://github.com/momentxrdd/components-v2)

### Minimalist bot direction

A recent practitioner write-up argues that classic embeds create visual
noise, consume screen space, and feel impersonal, while Discord markdown and
Components V2 can produce a native-feeling, understated UI. Key lessons:
restraint is a feature; not every action needs a card; keep feature logic
separate from UI.

Source:
- [Why we ditched Discord embeds for Components V2](https://dev.to/yuaxx/why-we-ditched-discord-embeds-for-components-v2-and-built-a-minimalist-bot-fb6)

### Open-source patterns

- `byCrookie/discord-music` downloads only the next needed track and trims
  storage, which matches this bot's new next/previous cache.
- `friday2su/lavalink-music-bot` uses clean embeds, pagination, and a small
  set of interactive controls.
- `AeroXDevs/AeroX-CV2-Music-Bot` and `princupy/Hima` are examples of
  Components V2 music UIs.
- `momentxrdd/components-v2` is a compact reference for Containers,
  Sections, Separators, Thumbnails, MediaGallery, and File.

### General UX principles

- Progressive disclosure: primary actions visible, secondary actions behind
  a select/modal.
- Consistency: same status/error/empty patterns everywhere.
- Feedback: every action gets an immediate state change.
- Error prevention: confirm destructive actions; disable expired controls.
- Mobile-first: keep text short, fields few, controls reachable.

---

## 6. Proposed design system

### 6.1 Message types

| Type | Use | Format |
|---|---|---|
| `card` | primary surfaces (help, now playing, queue, temp VC, admin status) | Components V2 container + sections + separators |
| `success` | completed action | short ephemeral text, optional check icon |
| `error` | failed action | short ephemeral text, actionable hint |
| `empty` | no data | short text + one next action |
| `confirm` | destructive | compact card/row with Cancel + Danger |
| `loading` | long operation | defer + short status; update same message |

### 6.2 Shared primitives

- `ui.card({ title, description, accent, sections, actions })`
- `ui.stat(name, value, hint?)`
- `ui.button(label, style, customId, emoji?)`
- `ui.select(placeholder, options)`
- `ui.confirm({ title, body, confirmLabel, onConfirm })`
- `ui.error(message, hint?)`
- `ui.success(message)`
- `ui.empty(message, actionLabel?)`

### 6.3 Copy rules

- Sentence case.
- Verb-first: "Skipped 2 tracks.", "Locked the channel."
- No "Use the buttons below."
- No internal markers in user-visible text.
- Max one emoji per card, only when it adds meaning.
- Timestamps only where time matters.

### 6.4 Color rules

- Primary accent: normal cards.
- Green: success only.
- Red: destructive/errors only.
- No feature-specific rainbow sidebars.

---

## 7. Prioritized roadmap

### P0 — Foundation

1. Add shared UI kit and `ReplyPayload` support for Components V2
   (`flags`, V2 component types, files).
2. Convert help landing + command detail.
3. Convert music now-playing card and reduce controls to one primary row +
   one `More` select.
4. Convert Temp VC panel to compact container; move delete/kick/transfer
   behind a `Manage` select and confirmation.
5. Add shared success/error/empty/loading helpers and migrate the most
   visible commands.

### P1 — High-traffic polish

6. Music queue card with pagination buttons and cleaner metadata.
7. Family consent card with live countdown, disabled buttons, and outcome.
8. Admin config dashboards with edit actions and consistent labels.
9. Leaderboards: medals/right-aligned values + pagination.
10. Confirmation for `privacy delete`, `clearqueue`, `stop`, and
    `confession delete`.

### P2 — Consistency pass

11. Social/love/bias/friendship cards.
12. Birthday/activity/ping/privacy cards.
13. Confession/delulu/welcome polish.
14. Remove duplicate commands (`clear` vs `clearqueue`, `stop` vs
    `disconnect`) or make one an alias.
15. Mobile screenshot review and final copy pass.

---

## 8. Decisions needed before implementation

1. **Components V2 adoption:** use it for primary cards only, or migrate all
   embeds? Recommendation: primary cards first, keep ephemeral text for
   simple states.
2. **Color system:** single accent + semantic success/danger, or keep
   per-feature colors? Recommendation: single accent.
3. **Music controls:** 5 primary controls + `More` select, or a smaller
   3-button row (pause, skip, queue)? Recommendation: 3 primary + `More`.
4. **Command consolidation:** merge `clear`/`clearqueue` and
   `stop`/`disconnect`? Recommendation: yes, keep aliases for compatibility.
5. **Admin UI:** read-only status cards first, or full interactive
   dashboards? Recommendation: status cards + edit buttons for the most-used
   settings.
6. **First implementation batch:** help + now-playing + temp VC panel, or
   help + all music? Recommendation: help + now-playing + temp VC panel.

---

## 9. P0 implementation status (2026-10-22)

Completed in the first pass:

- Shared Components V2 UI kit (`features/ui.ts`) and V2-aware reply payloads.
- Help landing, category list, and command detail converted to V2.
- Music now-playing/play result converted to a V2 card with a reduced control
  set (Pause/Resume, Skip, More select).
- Music button/select handlers now update the same card instead of sending
  extra status messages where practical.
- Temp VC panel converted to a compact V2 card with Lock/Rename/Limit plus a
  Manage select for Kick/Transfer/Delete.
- Temp VC delete is behind a confirmation card.
- Shared success/error/empty helpers added; music and `vc` confirmations use
  the success/error helpers.
- `vc info` converted to a compact card with a Discord relative timestamp.
- UI primitive tests added for V2 payloads and progress bars.

Still planned:

- Queue card with pagination buttons (P1).
- Admin config dashboards (P1).
- Leaderboard formatting/pagination (P1).
- Confirmation for `privacy delete`, `clearqueue`, `stop`, `confession delete`
  (P1).
- Social/family/confession/delulu polish (P2).
