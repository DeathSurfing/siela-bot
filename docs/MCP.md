# Siela MCP

The MCP server exposes the bot's control API as typed tools. It has no Discord
token and no database credentials. 51 tools in `apps/mcp/src/tools.ts`.

## Transports

| Mode | Endpoint | Auth |
|---|---|---|
| stdio | `node apps/mcp/dist/index.js --stdio` | Process isolation |
| HTTP on the Podman network | `MCP_URL=http://mcp:8080/mcp` | `Authorization: Bearer <MCP_TOKEN>` |
| HTTP on the host (optional) | `http://127.0.0.1:8080/mcp` | Same token; use `compose.host.yaml` |
| Streamable HTTP | `/mcp` | Same token |

## Client examples

**stdio (Podman):**

```json
{
  "mcpServers": {
    "siela": {
      "command": "podman",
      "args": [
        "run", "-i", "--rm",
        "--network", "siela_mcp",
        "--env-file", "deploy/podman/.env",
        "localhost/siela-mcp:latest",
        "--stdio"
      ]
    }
  }
}
```

**HTTP on the Podman network:**

```json
{
  "mcpServers": {
    "siela": {
      "url": "http://mcp:8080/mcp",
      "headers": { "Authorization": "Bearer ${MCP_TOKEN}" }
    }
  }
}
```

## Tool groups (51 tools)

- `bot_status`, `commands_list`
- `prefix_get`, `prefix_set`, `prefix_reset`
- `welcome_get`, `welcome_update`, `welcome_test`
- `autorole_get`, `autorole_update`, `autorole_validate`, `autorole_sync`
- `counters_get`, `counters_leaderboard`, `optouts_list`, `counters_reset`
- `tempvc_get_config`, `tempvc_update_config`, `tempvc_list`, `tempvc_get`,
  `tempvc_update`, `tempvc_permit`, `tempvc_deny`, `tempvc_disconnect`,
  `tempvc_claim`, `tempvc_transfer`, `tempvc_delete`
- `music_get_config`, `music_update_config`, `music_join`, `music_play`,
  `music_pause`, `music_resume`, `music_skip`, `music_stop`, `music_queue`,
  `music_nowplaying`, `music_volume`, `music_seek`, `music_loop`,
  `music_shuffle`, `music_remove`, `music_clear`, `music_move`, `music_jump`,
  `music_autoplay`, `music_filters`, `music_disconnect`
- `message_send`, `audit_tail`, `privacy_delete_user_data`

Destructive tools (`autorole_sync`, `counters_reset`, `tempvc_delete`,
`message_send`, `privacy_delete_user_data`) require `confirm: true`.
All mutations are audited.

There are no tools for the economy, delulu, TTS, or social commands —
those are Discord-only.
