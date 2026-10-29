# Siela admin dashboard

The dashboard is a self-hosted control panel for the bot. It shows bot health, connected servers, feature flags, music playback, server settings, audit history, and registered commands. The selected server stays in the URL and in browser storage.

## Set up the dashboard

Generate a dashboard password and a separate session signing secret. Keep both in the private `.env` file.

```sh
openssl rand -base64 24
openssl rand -base64 48
```

Set the first value as `DASHBOARD_PASSWORD`. Set the second as `DASHBOARD_SESSION_SECRET`. The password must have at least 12 characters. The session secret must have at least 32 characters. The dashboard exits at startup when either value is missing or too short.

If `scripts/podman-init.sh` created `.env`, add both values before starting the stack. The script leaves them blank so the dashboard cannot start with a public placeholder password.

Set `MCP_TOKEN` to the same bearer token used by the bot control API. Set `CONTROL_API_URL` to the bot control service address. In the Podman stack, the default is `http://bot-control:3001`.

Build and start the dashboard with the rest of the stack:

```sh
podman compose -p siela -f deploy/podman/compose.yaml up -d --build dashboard
```

The dashboard listens on `DASHBOARD_HOST` and `DASHBOARD_PORT`. Compose publishes the host port from `DASHBOARD_PORT`. Put a TLS reverse proxy in front of any public-facing deployment. Do not expose the bot control API.

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
