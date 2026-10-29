# Siela admin dashboard

The dashboard is a self-hosted control panel for the bot. It shows bot health, connected servers, feature flags, music playback, server settings, audit history, and registered commands. The selected server stays in the URL and in browser storage.

## Set up the dashboard

`scripts/podman-init.sh` generates `DASHBOARD_PASSWORD` and `DASHBOARD_SESSION_SECRET` with the rest of the stack secrets and prints where the password is stored. Read it with:

```sh
grep DASHBOARD_PASSWORD deploy/podman/.env
```

To set your own values, export them before running the init script or edit `.env` afterwards. The password must have at least 12 characters. The session secret must have at least 32 characters. The dashboard exits at startup when either value is missing or too short.

`MCP_TOKEN` is the same bearer token used by the bot control API. `CONTROL_API_URL` is the bot control service address. In the Podman stack, the default is `http://bot-control:3001`.

Build and start the dashboard with the rest of the stack:

```sh
podman compose -p siela -f deploy/podman/compose.yaml up -d --build dashboard
```

The dashboard listens on `DASHBOARD_HOST` and `DASHBOARD_PORT` inside its container. Compose publishes the host port from `DASHBOARD_PORT` and defaults to `3000`. Set `DASHBOARD_PORT` to change the host port. Put a TLS reverse proxy in front of any public-facing deployment. Do not expose the bot control API.

## Operating notes

Feature switches apply immediately. The dashboard shows an Undo action after each change, and a failed write reverts the switch and shows the API message inline.

The music tab needs a voice channel ID. A browser cannot report which Discord voice channel its operator is in, so paste the target channel's ID into the field above **Add to queue**. The dashboard stores it per server in browser storage. Right-click a voice channel in Discord and choose **Copy ID**; enable Developer Mode under Discord's advanced settings if that item is missing.

Settings save one section at a time. Boolean switches save their visible state, and role ID fields accept a comma-separated list.

## Browser API

The browser uses these same-origin routes:

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/login` | Check the dashboard password and issue a session cookie plus CSRF token. |
| `POST` | `/api/logout` | Clear the signed session. |
| `GET` | `/api/session` | Check the session and return its CSRF token when signed in. |
| `GET` | `/api/status` | Read bot readiness and health. |
| `GET` | `/api/guilds` | List servers the bot serves. |
| `GET` | `/api/guilds/:guildId/features` | Read feature toggles. |
| `PATCH` | `/api/guilds/:guildId/features/:featureId` | Change one feature toggle. |
| `GET` | `/api/guilds/:guildId/audit?limit=50` | Read recent actions. |
| `GET` | `/api/guilds/:guildId/music` | Read player and queue state. |
| `POST` | `/api/guilds/:guildId/music/:action` | Run a whitelisted music action. |
| `GET` | `/api/guilds/:guildId/config` | Read settings for all supported sections. |
| `PATCH` | `/api/guilds/:guildId/config/:section` | Update `prefix`, `welcome`, `autorole`, `tempvc`, or `music`. |
| `GET` | `/api/commands` | Read command registry metadata. |
| `GET` | `/healthz` | Check the dashboard process. |

All `/api` routes except login require a valid session. Mutations also require the `x-csrf-token` header. The music route accepts only `join`, `play`, `pause`, `resume`, `skip`, `stop`, `volume`, `seek`, `loop`, `shuffle`, `clear`, and `disconnect`. The dashboard has no generic proxy route.

## Session and request security

The `siela_dashboard` cookie contains only an expiry payload and its HMAC-SHA256 signature. It is `HttpOnly` and `SameSite=Strict`, and expires after 12 hours. The server compares signatures, CSRF tokens, and passwords in constant time. Login allows five attempts per IP in each five-minute window.

The server sets a restrictive content security policy, denies framing, disables MIME sniffing, and sends a no-referrer policy. Static requests resolve inside `apps/dashboard/public`; traversal and symlink escapes are rejected. The container runs read-only, drops capabilities, and writes only to its `/tmp` tmpfs.

The browser never receives `MCP_TOKEN`. `apps/dashboard/src/control-client.ts` is the single server-side adapter for bearer-authenticated requests. It sets `x-guild-id` on every guild-scoped control request. Dashboard route parameters, methods, configuration sections, and music actions are allowlisted before they reach that client.

## Network boundary and guild scope

Compose attaches the dashboard to the `edge` network for browser traffic and to the internal `control` network for bot requests. Only the dashboard's port is published. Keep `bot-control:3001` on the internal control network and do not publish it to the host or the internet.

The operator selects a server in the header. The dashboard stores that selection in `localStorage` and reflects it in the hash route. Each server-scoped request sends that server's ID in `x-guild-id`; the control API then scopes reads and writes to that guild. The server list and status endpoints are not guild-scoped.

The control API must expose the routes in the dashboard build contract. In particular, the guild and feature routes are new control API work and may not exist until that branch is integrated. Until they do, the dashboard reports the control API's error inline. A missing or invalid bearer token has a distinct message, and a network failure reports that the control API is unreachable.
