# Delulu

`/delulu` generates a short fictional scenario where the caller's saved bias notices them. Cooldown 5s.

## First-use bias setup

If no bias is saved, `/delulu` opens a modal with two required dropdowns: bias and bias wrecker. Each dropdown contains all seven BTS members; the selections must be different. Submitting saves the choices and immediately runs the requested scenario, with the usual coin cost and daily limit. The NSFW option is preserved through setup.

Prefix commands such as `!delulu` show a **Set bias & continue** button, because a text message cannot open a Discord modal directly. Only the requesting user can use the setup. Setup buttons and modals expire after five minutes; invalid selections offer a retry without saving or charging. If generation is blocked by insufficient funds or the daily limit, the saved bias remains available for the next request. Members can still manage their saved choices with `/bias`.

- Code: `apps/bot/src/features/delulu.ts` (`DeluluService.generate`), `apps/bot/src/commands/social/delulu.ts`.

## Backend chain

Tried in order; each step must return usable text or the next step runs:

1. Local llama.cpp (`LLM_URL`, `POST /v1/chat/completions`): model `LLM_MODEL`, default `"default"`. Compose (`deploy/podman/compose.yaml`) serves `DeathSurfing/tinyTanLLM-delulu-gemma` (`delulu-gemma-q4_k_m.gguf`, 1.6 GB) on `ghcr.io/ggml-org/llama.cpp:server-cuda` with `LLM_URL=http://llm:8000`, context 1024, q8_0 KV cache, flash attention, n-gram speculation (`--spec-type ngram-simple`), a single slot (`--parallel 1`), and no host-side prompt cache (`--cache-ram 0`), and all 27 layers in VRAM (`-ngl 99`). This needs an NVIDIA driver that supports CUDA 12.8 (550 or newer; verified on 595.112.07), and the userspace libraries in `/opt/nvidia-libs` must match the kernel module. Holding the weights in VRAM keeps host RAM near 250 MB instead of 1.1 GB and generates about 90-120 tok/s instead of 13. JSON-schema response, max 256 tokens, 20s timeout, 2 retries. Parsed into `scene/notice/escalation/line` and composed as sentences.
2. Hugging Face router (`https://router.huggingface.co/v1/chat/completions`, needs `HF_TOKEN`): model `huihui-ai/Qwen2.5-0.5B-Instruct-abliterated-v3`. Max 140 tokens, 25s timeout, 1 retry. Returned as-is after stripping `<think>` blocks.
3. Pollinations (`https://text.pollinations.ai/...`, no token): 20s timeout, 1 retry. Responses containing "free limit reached" or "please wait" are discarded.
4. Static fallback: one of 5 SFW (or 5 NSFW) hardcoded scenarios, prefixed with the bias name. Always succeeds.

Only step 4 throwing counts as generation failure (practically unreachable).

## Costs and refunds

- SFW: 5 SC, capped at 4 uses/day. NSFW (`/delulu nsfw` or `delulu nsfw/true/on/1`): 15 SC, no daily cap — surge pricing (doubling per use) and coin balance are the only limits.
- Charged via `economy.spend` before generation; insufficient funds returns "You need {cost} SC to run delulu...".
- On generation failure the cost is refunded via `economy.award` (`delulu_refund`); a failed refund is written to the audit log (`delulu.refund_failed`).

## NSFW note

- The `nsfw` flag only changes the prompt/model instructions and the price. There is no NSFW-channel enforcement in code (the command does not set `nsfw: true`), no premium/admin bypass, and no cooldown tiers beyond the flat 5s cooldown.
