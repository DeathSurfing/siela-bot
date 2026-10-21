# Siela Bot — Threat model (summary)

| Threat | Control |
|---|---|
| Non-admin config changes | Runtime `assertAdmin` on every admin command; audit log |
| Auto-role privilege escalation | Reject `Administrator`, managed, `@everyone`, and above-bot roles |
| Temp VC abuse | Channel-scoped owner permissions only; no guild Kick/Ban; bot overwrite guard |
| Private VC bypass | Dedicated category; `tempvc setup` warns about role-level `Connect` allows |
| MCP token leak | One generated `MCP_TOKEN`; MCP only on the internal `mcp` network by default; destructive tools require `confirm`; audit |
| Prompt injection | No SQL/shell/arbitrary URL tools; bounded outputs; human confirmation |
| SSRF from music URLs | http(s)-only URLs; private-IP/loopback/link-local blocking; yt-dlp runs inside the bot container |
| Mention spam | `allowedMentions` is empty unless a welcome explicitly enables user pings |
| Secret leakage | Generated `.env` (600); Podman secrets optional; Pino redaction |
| Data loss | Postgres volume plus `pg_dump` backups; restore drill in the runbook |
| Container compromise | Rootless Podman; non-root users; read-only root filesystems; dropped capabilities |

Residual risks: third-party music availability and terms, Hugging Face NLLB
translation quality/CPU use, role-level Discord permission bypass for “private”
VCs, and MCP token compromise on the private network when MCP is enabled.
