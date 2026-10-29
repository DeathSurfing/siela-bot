# Multi-guild operation

The bot serves every Discord guild it joins. `GUILD_ID` is optional and pins a deployment to one guild. A pinned deployment leaves any other guild it is invited to.

## Binding rules

| `GUILD_ID` | Behaviour |
| --- | --- |
| unset | Serve every guild in the Discord gateway cache. New guilds initialize on `GuildCreate`. |
| set | Serve only that guild. Every other guild is left on join. |

Readiness requires at least one served guild and a reachable database. The dashboard and the control API report the served guild list.

## What is per guild

Each guild gets its own settings row, slash-command registration, temporary-VC reconcile, activity and leveling reconcile, random voice-drop scheduler, scheduled-event scheduler, and relic auction scheduler.

Runtime state that is already keyed by guild id:

- music players, voice locks, idle timers, now-playing messages
- TTS sessions and idle unload timers
- Tambola and Cards Against Humanity sessions
- blackjack games and shoes
- activity, leveling, and friendship counters
- temporary voice channel cleanup timers
- voice sound-effect cooldowns and playback

## What is process wide

These run once per process and already scan or aggregate across guilds:

- activity flush timer and friendship pair accrual
- birthday sweep
- fleet heartbeat
- database and Valkey connection pools

The relic scheduler uses one interval and iterates the served guilds, so a slow auction settlement in one guild does not block another.

## Control API

Every guild-scoped route resolves the guild in this order:

1. `x-guild-id` request header
2. `guildId` query parameter
3. the configured `GUILD_ID`
4. the only served guild, when exactly one is served

A request that is still ambiguous returns `400` with code `guild_required`. A guild this node does not serve returns `400` with code `unknown_guild`. This keeps every existing automation working against a single-guild deployment.

`GET /v1/guilds` lists the served guilds:

```json
{
  "guilds": [
    {
      "id": "123456789012345678",
      "name": "Server",
      "iconUrl": "https://cdn.discordapp.com/icons/...",
      "memberCount": 42,
      "ownerId": "987654321098765432",
      "joinedAt": 1710000000000,
      "available": true
    }
  ]
}
```

## Voice fleet

The heartbeat record now carries `guildIds`, the full list of guilds a node serves. A reader still finds the primary `guildId`, so older records keep working.

The router resolves the target guild from `x-guild-id` or a `guildId` body field, and forwards the header to the commander and to voice workers. Worker routes use the same header, so one worker process can serve several guilds. The semaphore is per guild: capacity is the number of nodes heartbeating for that guild.

`POST /v1/session/preempt` accepts `{ "guildId": "..." }` and only clears nodes serving that guild.

A voice worker still leaves every guild except `GUILD_ID` when that variable is set. Leave it unset to let workers serve any guild the commander routes to them.

## Data and removal

Every table is keyed by `guild_id`. Removing the bot from a guild stops its schedulers and leaves its rows in place, so a re-invite restores the server. Purging a guild is a separate operator action; it is not automatic.

The default welcome message still contains a server-specific string. New guilds inherit it and typically edit it from the dashboard or with `/welcome`.

## Operational limits

- Slash commands are registered per guild on first init. Discord rate-limits command writes per guild and globally, so joining a large number of guilds at once is slower than joining one.
- The relic scheduler performs one sequential pass per guild per tick. Keep the guild count in mind when tuning `relic_settings`.
- Presence shows the guild count when more than one guild is served.
- Scheduled audio events create and move voice channels per guild. They do not coordinate between guilds.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `guild_required` from the control API | Several guilds are served and no guild was named | Send `x-guild-id` |
| `unknown_guild` | The header names a guild this node does not serve | Check `GET /v1/guilds` |
| Slash commands missing in one guild | Registration failed during init | Check logs for `guild init failed`; re-invite or restart |
| Guild stays silent after invite | `GUILD_ID` pins another guild | Unset `GUILD_ID` or remove the pin |
