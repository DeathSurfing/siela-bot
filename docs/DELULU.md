# Delulu

`/delulu` generates a short fictional scenario where the caller's saved bias notices them. Requires a saved bias (`bias <member> <wrecker>`). Cooldown 5s.

- Code: `apps/bot/src/features/delulu.ts` (`DeluluService.generate`), `apps/bot/src/commands/social/delulu.ts`.

## Backend chain

Tried in order; each step must return usable text or the next step runs:

1. Local llama.cpp (`LLM_URL`, `POST /v1/chat/completions`): model `LLM_MODEL`, default `"default"`. Compose (`deploy/podman/compose.yaml`) serves `DeathSurfing/tinyTanLLM-delulu-gemma` (`delulu-gemma-q4_k_m.gguf`, 1.7 GB) on `llama.cpp:server-cuda` with `LLM_URL=http://llm:8000`, context 1024, full GPU offload. JSON-schema response, max 256 tokens, 20s timeout, 2 retries. Parsed into `scene/notice/escalation/line` and composed as sentences.
2. Hugging Face router (`https://router.huggingface.co/v1/chat/completions`, needs `HF_TOKEN`): model `huihui-ai/Qwen2.5-0.5B-Instruct-abliterated-v3`. Max 140 tokens, 25s timeout, 1 retry. Returned as-is after stripping `<think>` blocks.
3. Pollinations (`https://text.pollinations.ai/...`, no token): 20s timeout, 1 retry. Responses containing "free limit reached" or "please wait" are discarded.
4. Static fallback: one of 5 SFW (or 5 NSFW) hardcoded scenarios, prefixed with the bias name. Always succeeds.

Only step 4 throwing counts as generation failure (practically unreachable).

## Costs and refunds

- SFW: 5 SC. NSFW (`/delulu nsfw` or `delulu nsfw/true/on/1`): 15 SC.
- Charged via `economy.spend` before generation; insufficient funds returns "You need {cost} SC to run delulu...".
- On generation failure the cost is refunded via `economy.award` (`delulu_refund`); a failed refund is written to the audit log (`delulu.refund_failed`).

## NSFW note

- The `nsfw` flag only changes the prompt/model instructions and the price. There is no NSFW-channel enforcement in code (the command does not set `nsfw: true`), no premium/admin bypass, and no cooldown tiers beyond the flat 5s cooldown.
