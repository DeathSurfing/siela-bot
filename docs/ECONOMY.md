# Economy

Siela Coins (SC). One balance per user per guild. All balance changes write an immutable row to `economy_transactions` in the same DB transaction.

Storage: `economy_accounts`, `economy_transactions` (immutable ledger), `premium_passes`, `economy_shop_items`, `economy_inventory`. Valkey caches balance for 60s (`apps/bot/src/features/economy.ts:85`) and leaderboard for 30s (`apps/bot/src/features/economy.ts:385`); DB is the source of truth when Valkey is unavailable.

Commands: `economy balance|daily|work|transfer|top|shop|buy|coinflip|slots|blackjack|premium|grant|adjust|shopadd|shopremove` (`apps/bot/src/commands/utility/economy.ts:45`). Aliases: `eco`, `coins`, `balance`. Framework cooldown 3s on economy commands.

## Earning

- `daily`: 10 SC base, streak multiplier up to 7x (so 10–70 SC). 24h cooldown, 36h streak window (`apps/bot/src/features/economy.ts:14-16`, `apps/bot/src/features/economy.ts:114-117`). Race-safe: the claim is a single conditional UPDATE, so concurrent claims cannot double-pay.
- `work`: 1–4 SC, 2h cooldown (`apps/bot/src/features/economy.ts:169`, `apps/bot/src/features/economy.ts:173`).
- Social-command award: 1 SC per social command, idempotent per interaction, 20/day cap.
- Any-successful-command award: 1 SC, 5/hour cap.
- `transfer` in from another member: 1–1,000,000 SC per transfer; no self-transfers, no bot recipients (`apps/bot/src/features/economy.ts:215-218`, `apps/bot/src/commands/utility/economy.ts:107-109`). Transfers fail with `INSUFFICIENT_FUNDS` rather than going negative.
- Admin `adjust` can add or remove coins (see Admin).

## Spending and games

- `transfer <user> <amount>`: 1–1,000,000 SC. Debited atomically; fails if balance is insufficient.
- `coinflip <amount> <heads|tails>`: 45% win chance, win pays 2x the bet (`apps/bot/src/commands/utility/economy.ts:291-293`). Bet is spent up front.
- `slots <amount>`: any pair pays 2x, triple pays 5x (`apps/bot/src/commands/utility/economy.ts:314-315`). Otherwise the bet is lost.
- `blackjack <amount>`: bet spent up front; win pays 2x, blackjack pays 2.5x (floored), push returns the bet (`apps/bot/src/features/economy.ts:653-683`). One hand per user at a time. Games are in-memory only (`apps/bot/src/features/economy.ts:588`) and are lost on restart.
- Actually charged features: delulu 5 SC SFW / 15 SC NSFW per use (refunded on failure); Tambola extra ticket 25 SC; Tambola per-player auto-mark 10 SC; `premium_30d` 2000 SC for 30 days (`apps/bot/src/commands/utility/economy.ts:7-13`).

## Shop

`economy shop` lists the global catalog plus per-guild server items. `economy buy <item>`:

- `delulu` / `delulu_nsfw` are not purchasable; they are charged automatically per use (`apps/bot/src/commands/utility/economy.ts:165-167`).
- `tambola_ticket` (25 SC) and `tambola_automark` (10 SC) are bought through the Tambola service for the current lobby.
- `premium_30d` (2000 SC) spends coins then grants 30 days of premium; if the grant fails after payment, the 2000 SC is refunded (`apps/bot/src/commands/utility/economy.ts:191-209`).
- Any other key falls through to the per-guild server shop (`buyItem`, `apps/bot/src/features/economy.ts:524`): stock (if set) is decremented, inventory quantity incremented, and a linked role (if set) is granted best-effort (`apps/bot/src/commands/utility/economy.ts:211-228`).

## Premium

- `economy premium` shows whether you have an active pass.
- `economy buy premium_30d` self-purchases 30 days for 2000 SC.
- Premium is status-only: it does not bypass any cost or cooldown. Everyone, including premium holders, still pays (see Design vs implementation).

## Admin

Requires admin permissions (`Manage Guild`/owner/`BOT_OWNER_ID`/`ADMIN_ROLE_IDS`); denied otherwise.

- `economy grant <user> <days>`: grants a premium pass for N days, audited as `economy.premium.grant` (`apps/bot/src/commands/utility/economy.ts:344-359`).
- `economy adjust <user> <amount> <reason>`: adds (positive) or removes (negative) coins. Reason and actor are recorded in the ledger (`reason by actorId`, `apps/bot/src/features/economy.ts:344-351`); negative adjustments fail instead of driving the balance below zero. Audited as `economy.adjust`.
- `economy shopadd <key> <price> <name>` / `economy shopremove <key>`: manage the per-guild server shop. Keys match `^[a-z0-9_-]{1,32}$` and are lowercased; price must be a positive integer (`apps/bot/src/features/economy.ts:492-522`). Audited as `economy.shop.add` / `economy.shop.remove`.
- `economy balance <user>` and `economy top` work for all members; `top` shows the 10 richest.

## Design vs implementation

`docs/ECONOMY_PLAN.md` and `docs/CURRENCY_GATING.md` are design history, not the implemented truth. Known differences:

- Daily is 10 SC base up to 7x with 24h cooldown and 36h streak window, not 50 SC / 20h / 30x.
- Work is 1–4 SC with a 2h cooldown; no activity requirement.
- Only delulu (5/15 SC) and Tambola extra ticket (25 SC) / auto-mark (10 SC) are actually charged. TTS voices, Temp VC perks, event triggers, confession boosts, and family perks are not gated.
- Premium/admin bypass is not wired: premium is status-only and everyone still pays; there are no supporter tiers or tiered cooldowns.
- Not implemented: transfer caps (only the 1,000,000 per-transfer max), crime, quests, message/voice-time/passive rewards, account-age gates, earn caps, freeze/reset-cooldown commands.
- Blackjack games are in-memory only and lost on restart.
