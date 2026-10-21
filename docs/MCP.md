# Siela MCP

The MCP server exposes the bot's control API as typed tools. It has no Discord
token and no database credentials.

## Transports

| Mode | Endpoint | Auth |
|---|---|---|
| stdio | `node apps/mcp/dist/index.js --stdio` | Process isolation |
| HTTP on the Podman network | `MCP_URL=http://mcp:8080/mcp` | `Authorization: Bearer <MCP_TOKEN>` |
| HTTP on the host (optional) | `http://127.0.0.1:8080/mcp` | Same token; use `compose.host.yaml` |

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

## Tool groups

- `bot_status`, `commands_list`
- `prefix_*`
- `welcome_*`
- `autorole_*`
- `counters_*`, `optouts_list`
- `tempvc_*`
- `music_*`
- `message_send`
- `audit_tail`
- `privacy_delete_user_data`

Destructive tools require `confirm: true`. All mutations are audited.
