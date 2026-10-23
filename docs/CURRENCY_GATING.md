> Design history, not implemented truth. See docs/ECONOMY.md for what is actually implemented.
> Key differences: daily is 10 SC base up to 7x (not 50 SC / 20h); work is 1-4 SC with 2h cooldown; only delulu (5/15 SC) and Tambola extra ticket (25 SC) / auto-mark (10 SC) are actually charged; premium/admin bypass is not wired (premium is status-only, everyone still pays).

# Currency Gating Design (Single Guild)

## Currency
- **Name:** Siela Coins (SC). Stored per user in `user_wallets`.
- **Ledger:** every grant/spend writes `currency_transactions` (audit-friendly).
- **Admin bypass:** users with `Manage Guild` / owner / `ADMIN_ROLE_IDS` bypass cost + cooldown, but actions are still audited.

## Tiers
| Tier | How obtained | Unlocks |
|---|---|---|
| Free | default | base features only |
| Supporter | 7-day auto-tier from activity score (no coins) | reduced cooldowns, 1 free delulu/day |
| Premium | `premium buy 30d` (2,000 SC) or admin `premium grant` | all gated features, no per-use cost |

## Earning (non-premium)
- `daily` — 50 SC / 20h, +10 SC streak bonus every 7 days.
- Activity — 1 SC per 10 messages (cap 50/day), 1 SC per 5 min voice (cap 30/day).
- Milestones — social counter thresholds, confession streaks, family milestones grant SC.
- Admin — `grant @user <amount>`.

## Gated Features
| Feature | Cost model | Cooldown (free / supporter / premium) | Admin bypass |
|---|---|---|---|
| Delulu (SFW) | 5 SC/use or Premium | 60s / 30s / 15s | yes |
| Delulu NSFW | 15 SC/use or Premium (Premium tier only) | 120s / 60s / 30s | yes |
| Music filters | 10 SC/activation or Premium | per track / 30s / none | yes |
| TTS voices | 3 SC/message or Premium; default voice free | 10s / 5s / none | yes |
| Temp VC perks (extra channels, custom name, +limit) | 20 SC / 7 days or Premium | creation 60s / 30s / none | yes |
| Scheduled event trigger (manual) | 50 SC/use or Premium+admin | 1h / 1h / 30m | yes |
| Confession boost (pin/highlight 24h) | 10 SC/boost | 1 boost/6h / 1/3h / 1/1h | yes |
| Family perks (depth 5, portrait, fast adoption) | 25 SC / 30 days or Premium | adoption 24h / 12h / none | yes |

## Commands
```
balance                 # show wallet + tier + pass expiry
daily                   # claim daily reward
shop                    # list purchasable passes/perks
buy <item>              # spend SC (e.g. buy premium30)
premium                 # show premium status
grant @user <amount>    # admin: grant SC
premium grant @user 30d # admin: grant premium pass
resetcooldown @user      # admin: clear cooldowns
```

## UX Flow (denial example)
```
❌ Delulu NSFW costs 15 SC. You have 3 SC.
Earn more: daily, chat/voice activity, or ask an admin.
Try: !daily  |  !shop
```
Premium users see no cost line; admins see `(admin bypass)`.

## Data Model Additions
- `user_wallets(guild_id, user_id, balance, updated_at)`
- `currency_transactions(id, guild_id, user_id, amount, reason, ref_id, created_at)`
- `premium_passes(guild_id, user_id, tier, expires_at, granted_by)`
- `user_activity_score(guild_id, user_id, messages, voice_seconds, score, updated_at)` (for Supporter tier)

## Gating Hook
```
async function gate(ctx, feature, cost) {
  if (isAdmin(ctx)) return { ok: true, bypass: true };
  if (hasPremium(ctx, feature)) return { ok: true };
  if (wallet.balance < cost) return deny(ctx, cost, wallet.balance);
  await wallet.spend(ctx.user, cost, feature);
  return { ok: true };
}
```

## Notes
- Single process/in-memory cooldowns remain; premium status cached with 60s TTL.
- All spends are transactional (DB transaction) to avoid double-spend.
- Audit log records `currency.spend` / `currency.grant` / `premium.grant`.
