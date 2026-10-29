# Per-guild feature flags

Each guild can turn whole features on or off. Flags are a master kill-switch layered over the
feature's existing settings: disabling a feature hides its commands and stops its behaviour, but
does not erase configuration. Re-enabling restores the previous settings.

## Catalog

The catalog lives in `packages/shared/src/features.ts` (`FEATURES`, `FeatureId`). Every entry
defaults to enabled.

| ID | Feature | Category | Commands | Depends on |
| --- | --- | --- | --- | --- |
| `music-playback` | Music playback | Music | play, join, pause, resume, skip, stop, queue, nowplaying, volume, seek, loop, shuffle, remove, clearqueue, move, jump, disconnect, autoplay, filters | — |
| `music-lyrics` | Lyrics | Music | lyrics | `music-playback` |
| `economy-core` | Economy | Economy | economy | — |
| `economy-stocks` | Stock market | Economy | stocks | `economy-core` |
| `relics` | Relic cards and auctions | Relics | relics, inventory, showcase | `economy-core` |
| `games-tambola` | Tambola | Games | tambola | `economy-core` |
| `games-cah` | Cards Against Humanity | Games | cah | — |
| `social-interactions` | Interactions | Social | slap, kiss, hug, chodu, wuzu, socialstats, socialtop, optout, optin | — |
| `social-family` | Family | Social | marry, divorce, adopt, runaway, familytree | — |
| `social-friendship` | Friendship | Social | friendship, friendshiptop | `engagement-activity` |
| `social-love` | Love calculator | Social | lovecalc | — |
| `social-bias` | Bias profiles | Social | bias | — |
| `social-delulu` | Delulu | Social | delulu | `social-bias`, `economy-core` |
| `moderation-confession` | Confessions | Community | confess, confession | — |
| `onboarding-welcome` | Welcome messages | Community | welcome | — |
| `onboarding-autorole` | Auto role | Community | autorole | — |
| `engagement-activity` | Activity tracking | Community | activity, activetop | — |
| `engagement-leveling` | Leveling | Community | level, levelchannel | `engagement-activity` |
| `engagement-birthday` | Birthdays | Community | birthday | — |
| `voice-tts` | Text to speech | Voice | tts | — |
| `voice-tempvc` | Temporary voice channels | Voice | vc, tempvc, jointocreate | — |
| `voice-moderation` | Voice moderation | Voice | moveall | — |
| `voice-sfx` | Voice sound effects | Voice | — | — |
| `automation-scheduled-events` | Scheduled audio events | Automation | test | — |
| `automation-random-drops` | Random voice drops | Automation | — | — |

`dependsOn` is declarative for now; the service does not enforce dependency chains. Dispatch
should treat a disabled dependency as enough reason to hide the dependent feature.

## Storage

`packages/db/src/schema.ts` defines `guild_features`:

| Column | Type | Notes |
| --- | --- | --- |
| `guild_id` | text, not null | references `guild_settings.guild_id`, `ON DELETE CASCADE` |
| `feature_id` | text, not null | catalog id; not a FK because the catalog ships with the bot |
| `enabled` | boolean, not null | default `true` |
| `updated_at` | timestamptz, not null | default `now()` |
| `updated_by` | text, null | actor id when known |

Primary key: `(guild_id, feature_id)`. No separate index on `guild_id` is needed; the primary key
covers guild-scoped reads and writes. A missing row means "use the catalog default", so guilds
start enabled without a backfill. `FeatureFlagService.ensureRows(guildId)` can materialise an
explicit row per catalog entry when a caller wants the dashboard to show stored records.

## Defaults and unknown ids

- All catalog features default to `true`.
- `isEnabled` returns `true` for ids that are not in the catalog (version skew is permissive).
- `set` / `setMany` reject unknown ids with `UserError` code `unknown_feature`.
- Stored rows whose `feature_id` is no longer in the catalog are ignored when resolving state.

## API contract

These routes are part of the control API and are wired by the integration work, not by
`FeatureFlagService` itself.

`GET /v1/features`

```json
{
  "guildId": "1561548714823258172",
  "features": [
    { "id": "music-playback", "label": "Music playback", "category": "Music", "enabled": true }
  ]
}
```

`PATCH /v1/features` with body `{ "featureId": "relics", "enabled": false }` returns
`{ "featureId": "relics", "enabled": false }` and invalidates that guild's cache. Unknown
`featureId` returns `400` with `{ "error": { "code": "unknown_feature" } }`.

Both routes are guild-scoped by the `x-guild-id` header. The service is per-guild; handlers must
pass that guild id through and must reject requests without it.

## Dispatch and help

- Disabled features hide their commands from help and from command discovery.
- Commands stay registered with Discord. Registration does not change when a guild toggles a
  feature, so toggling is immediate and does not require a re-register or restart.
- The command handler should check `isEnabled(guildId, featureForCommand(name))` and silently
  ignore (or explain) commands whose feature is off.
- Background loops and event handlers should use `enabledMap(guildId)` once per pass and skip
  disabled features; cache TTL is 30 seconds by default and writes invalidate only that guild.
