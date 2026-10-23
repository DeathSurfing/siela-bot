# Security Policy

## Supported versions

Security fixes are applied to the current `main` branch. Older commits and forks are not supported.

## Reporting a vulnerability

Do not open a public issue for a security problem.

Use GitHub Security Advisories:

1. Open the repository Security tab.
2. Select **Report a vulnerability**.
3. Describe the issue, affected component, impact, and reproduction steps.

Include the smallest proof of concept that demonstrates the problem. Remove real tokens, user data, and private host information.

You can expect an initial response within a reasonable time. This is a volunteer project, so no formal service-level agreement is offered.

## Scope

Security reports are most useful for:

- Authentication or authorization bypass in commands, the control API, or MCP tools.
- Secret exposure in source, logs, build artifacts, or documentation.
- SQL injection, command injection, or unsafe deserialization.
- Server-side request forgery in music, avatar, or external content fetching.
- Economy duplication, negative balances, or ledger inconsistencies.
- Privilege escalation through auto-role, temporary voice channels, or role hierarchy checks.
- Unsafe container configuration, device exposure, or network boundary mistakes.
- Prompt injection or data exposure in the Delulu LLM path.
- Denial of service through unbounded input, queues, or resource use.

## Out of scope

- Vulnerabilities in Discord, YouTube, SoundCloud, Spotify, Hugging Face, or other third-party services.
- Issues that require a compromised host, a stolen Discord token, or administrator access.
- Rate-limit or spam reports that do not demonstrate a concrete security impact.
- Social engineering.
- Reports generated only by an automated scanner without a validated impact.

## Secret handling

- `deploy/podman/.env` is generated locally and must never be committed.
- Only `deploy/podman/.env.example` belongs in the repository.
- Rotate a secret immediately if it is exposed. Removing it from the current branch does not remove it from Git history or from forks.
- Use a dedicated Discord bot token for each deployment.

## Deployment assumptions

The threat model assumes a trusted host and a private Podman network. The control API and MCP server should not be published directly to the public internet without TLS and an authenticated reverse proxy. See [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) for controls and residual risks.
