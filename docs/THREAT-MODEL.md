# Siela Bot — Threat model (summary)

| Threat | Control |
|---|---|
| Non-admin config changes | Runtime `assertAdmin` on every admin command; audit log |
| Auto-role privilege escalation | Reject `Administrator`, managed, `@everyone`, and above-bot roles |
| Temp VC abuse | Channel-scoped owner permissions only; no guild Kick/Ban; bot overwrite guard |
| Private VC bypass | Dedicated category; `tempvc setup` warns about role-level `Connect` allows |
| MCP token leak | One generated `MCP_TOKEN`; MCP only on the internal `mcp` network by default; destructive tools require `confirm`; audit |
| Prompt injection via delulu/LLM | User input goes to a local vLLM model, never to SQL/shell; bounded JSON outputs; per-use economy charge caps volume |
| Delulu NSFW misuse | NSFW variant costs 15 SC vs 5 SC; prompts constrain output to consensual adult fanfiction (no minors, coercion, or explicit acts); enforcement is prompt-level only, not a channel age-gate |
| Economy ledger abuse | Daily (24h, streak-capped) and work (2h) cooldowns enforced with atomic compare-and-set; transfers/spends validated for insufficient funds; every grant/spend/transfer writes a ledger row plus audit entry |
| vLLM exposure | OpenAI-compatible endpoint with no auth, reachable only on the compose `edge`/`control` networks; not published to the host |
| KittenTTS exposure | Unauthenticated `/synthesize` and `/synthesize-stream` on the internal `data` network only; not published to the host |
| GPU device exposure | `/dev/nvidia*` nodes are passed into the `llm` and `bot` containers; a container escape there reaches the host GPU; mitigated by read-only roots, dropped capabilities, and `no-new-privileges` |
| Avatar-fetch SSRF | Welcome cards fetch the member's avatar URL with a 4s timeout; in practice only Discord CDN URLs are passed, but there is no private-IP/loopback block on that fetch path |
| SSRF from music URLs | http(s)-only URLs; private-IP/loopback/link-local blocking; yt-dlp runs inside the bot container |
| Mention spam | `allowedMentions` is empty unless a welcome explicitly enables user pings |
| Secret leakage | Generated `.env` (600); Podman secrets optional; Pino redaction |
| Data loss | Postgres volume plus `pg_dump` backups; stop-first restore drill in the runbook |
| Container compromise | Rootless Podman; non-root users; read-only root filesystems; dropped capabilities |

Residual risks: third-party music availability and terms, role-level Discord
permission bypass for “private” VCs, MCP token compromise on the private
network when MCP is enabled, prompt-level-only NSFW enforcement on delulu,
and host GPU exposure if a GPU-attached container is escaped.
