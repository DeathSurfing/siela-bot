> Design history, not implemented truth. See docs/ECONOMY.md for what is actually implemented.
> Key differences: daily is 10 SC base up to 7x (not 50 SC); work is 1-4 SC with 2h cooldown; only delulu (5/15 SC) and Tambola extra ticket (25 SC) / auto-mark (10 SC) are actually charged; premium/admin bypass is not wired (premium is status-only, everyone still pays).

# Economy Plan

Single-guild virtual currency for Siela Bot: **Siela Coins (SC)**. The economy exists to gate premium interactions (`delulu`, `delulu nsfw`, TTS voices, and Tambola extras) behind earned or purchased access, while giving members fun ways to earn coins.

This document consolidates the mechanics, gating, architecture, and abuse-mitigation findings from the economy planning subagents.

## 1. Currency model

- **Currency:** Siela Coins (SC).
- **Single balance:** one spendable SC balance per user. No separate wallet/bank and no robbery mechanic.
- **Two account layers:**
  - Normal users earn and spend SC.
  - Premium pass users get configured bypasses/cost reductions.
- **Admin controls:** grant, remove, freeze, adjust balances, reset cooldowns, grant premium.
- **Ledger:** every mutation writes an immutable `economy_transactions` row in the same DB transaction as the balance change.

## 2. Best earning ideas

Implement in this order:

### Phase 1 — Core retention

1. **Daily claim**
   - Base payout + streak multiplier.
   - 20h cooldown.
   - Streak breaks after 36h.
   - Cap multiplier around 30x.
2. **Work**
   - 1–2h cooldown.
   - Randomized payout ±30%.
   - Requires recent activity (message/voice in last 24h).
3. **Streaks**
   - Meta mechanic that boosts daily/work payouts.
   - Breaks at 36h.
   - Cap at 30x.

### Phase 2 — Risk and sinks

4. **Crime**
   - 40% big win, 60% fine + possible jail.
   - Jail disables earning for 2–6h.
   - No debt; fine cannot exceed balance.
5. **Gambling**
   - Coinflip/slots/dice.
   - House edge 3–5%.
   - Max bet ≤ 25% balance.
   - Daily loss cap.
   - No negative balances.

### Phase 3 — Passive social rewards

6. **Social rewards**
   - Small SC for `slap`, `kiss`, `hug`, `chodu`, `wuzu`.
   - Per-pair daily cap.
   - Opt-outs respected.
   - Diminishing returns after N interactions.
7. **Voice time**
   - SC per active minute.
   - AFK users still count; only self-deafened/muted users may be excluded if configured.
   - Daily cap (e.g. 120 minutes).
8. **Music listening**
   - SC per completed track.
   - Small bonus to requester if ≥2 listeners and full play.
   - Daily track cap.

### Phase 4 — Event and quest economy

9. **Tambola rewards**
   - Participation SC.
   - Win bonuses for line/full house.
   - Optional buy-in as a sink.
   - One reward per game per user.
10. **Quests**
    - 3 daily + 2 weekly rotating objectives.
    - Examples: slap 3 users, listen 5 tracks, voice 30 minutes, play Tambola, work once.
    - Server-side progress.
    - Rewards capped.

## 3. Anti-farm rules

Apply globally:

- Account age ≥ 7 days to earn; reduced rate for first 7 days.
- Server-side cooldowns/timestamps in DB, not client memory.
- Per-user daily earn cap and weekly hard cap.
- AFK users still count for activity; self-deafened or muted users may be excluded from voice/music payouts if desired, but AFK is not penalized.
- Social interactions reject self-targets.
- Per-pair daily caps and diminishing returns.
- Alt mitigation: optional toggle requiring friendship level ≥ 1 for high-value rewards.
- Burst joins flagged.
- All payouts auditable.
- Admins can freeze or adjust balances.

## 4. Currency gating

### Tiers

- **Free** — default.
- **Supporter** — auto-tier from activity (e.g. 7 days of meaningful activity).
- **Premium** — 2,000 SC / 30 days, or admin grant.

Admins (`Manage Guild`, owner, `BOT_OWNER_ID`, `ADMIN_ROLE_IDS`) bypass cost and cooldown, but mutations are audited.

### Feature costs and cooldowns

| Feature | Cost | Cooldown (free / supporter / premium) |
|---|---:|---|
| `delulu` SFW | 5 SC or Premium | 60s / 30s / 15s |
| `delulu nsfw` | 15 SC or Premium (Premium tier) | 120s / 60s / 30s |
| TTS voices | 3 SC/message or Premium; default voice free | 10s / 5s / none |
| Tambola auto-mark | Per-player purchase; covers all of that player's tickets | Lobby-only purchase |
| Tambola extra tickets | Purchase additional tickets for one game | Per-ticket cost |

Free features: music filters, Temp VC, confessions, family actions, and scheduled events with administrator run controls.

### Denial UX

```
❌ Delulu NSFW costs 15 SC. You have 3 SC.
Earn more: daily, chat/voice activity, or ask an admin.
```

### Gating hook

Before a gated action:

1. Admin bypass check.
2. Premium pass check.
3. Balance check.
4. Spend in the same transaction.
5. Record ledger row.
6. Audit if admin or high-value.

## 5. Sinks

- Gambling house edge.
- Shop: roles, name colors, VC perks, custom embeds.
- `delulu` per-use.
- Tambola extra tickets and auto-mark.
- Fines.

## 5.1 Tambola economy

- Players can buy **multiple tickets** in one game and gamble for larger rewards.
- **Auto-mark is a paid per-player feature**, not a global lobby setting. A player who buys it gets auto-marking for all of their tickets.
- Lobby settings can still show the host's default, but individual players can purchase auto-mark for themselves.
- Extra tickets and auto-mark are purchased per player, so a player with 5–10 tickets can auto-mark all of them.
- Tambola rewards should scale with ticket count and successful claims.

## 6. MVP scope

MVP is intentionally small:

- Single balance.
- `daily`.
- `balance`.
- `transfer`.
- `baltop`.
- Admin `economy adjust`.
- Immutable transaction ledger.
- No shop/inventory/gambling/loans/multi-currency in MVP.

## 7. Data model

Add to `packages/db/src/schema.ts`:

```ts
export const economyAccounts = pgTable("economy_accounts", {
  guildId: text("guild_id").notNull().references(() => guildSettings.guildId, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  balance: bigint("balance", { mode: "number" }).notNull().default(0),
  lastDailyAt: timestamp("last_daily_at", { withTimezone: true }),
  dailyStreak: integer("daily_streak").notNull().default(0),
  totalEarned: bigint("total_earned", { mode: "number" }).notNull().default(0),
  totalSpent: bigint("total_spent", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.guildId, t.userId] }),
  check("economy_balance_nonneg", sql`${t.balance} >= 0`),

]);

export const economyTransactions = pgTable("economy_transactions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  guildId: text("guild_id").notNull(),
  fromUserId: text("from_user_id"),
  toUserId: text("to_user_id"),
  amount: bigint("amount", { mode: "number" }).notNull(),
  kind: text("kind").notNull(),
  reason: text("reason"),
  idempotencyKey: text("idempotency_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("economy_tx_idempotency_uq").on(t.guildId, t.idempotencyKey).where(sql`${t.idempotencyKey} IS NOT NULL`),
  index("economy_tx_guild_created_idx").on(t.guildId, t.createdAt),
]);

export const premiumPasses = pgTable("premium_passes", {
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  grantedBy: text("granted_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.guildId, t.userId] }),
]);
```

Later phases add `economy_shop_items`, `economy_inventory`, `user_quests`, `user_activity_score`.

## 8. Service design

New `apps/bot/src/features/economy.ts` → `EconomyService(db, valkey, logger)`.

Methods:

- `ensureAccount(guildId, userId)`
- `getBalance(guildId, userId)`
- `deposit(guildId, userId, amount)`
- `withdraw(guildId, userId, amount)`
- `daily(guildId, userId)`
- `transfer(guildId, from, to, amount)`
- `award(guildId, userId, amount, kind, idempotencyKey?)`
- `adjust(guildId, userId, amount, reason, actorId)` (admin)
- `leaderboard(guildId, limit, offset)`
- `hasPremium(guildId, userId)`
- `grantPremium(guildId, userId, days, actorId)`
- `spendForFeature(guildId, userId, feature, amount, cooldownKey)`

Register in `Services` and wire in `bot.ts`.

## 9. Transactional integrity

- All mutations run in `db.transaction`.
- Lock account rows with `SELECT ... FOR UPDATE` in deterministic `userId` order.
- Ledger row inserted in the same transaction.
- `CHECK (balance >= 0)`.
- `daily` updates `lastDailyAt`, streak, and balance in one statement.
- `award` checks `idempotencyKey` first and returns the existing transaction if present.
- `transfer` validates amount, distinct users, target exists, no bots, max amount.
- No money is ever buffered in memory.

## 10. Caching and rate limits

Valkey keys:

- Balance: `siela:economy:bal:{guild}:{user}` (TTL 60s), invalidated on write.
- Leaderboard: `siela:economy:top:{guild}` (TTL 30s), invalidated on award/transfer.
- Rate limits: `siela:economy:rl:{action}:{guild}:{user}` with `INCR` + `EXPIRE`.
- If Valkey is unavailable, read/write DB directly.

Rate limits:

- `daily`: 24h per user via DB timestamp.
- `transfer`: max 10/day and 5/hour per user.
- Amount range: `1..1_000_000`.
- No self/bot transfers.
- Trigger awards: per-user caps (e.g. 50 message awards/hour, voice every 5 min).
- Framework cooldown: 3s on all economy commands.
- Admin `adjust`: 10/min per actor.

## 11. Commands

| Command | Access | Behavior |
|---|---|---|
| `balance [user]` | Everyone | Show SC balance. |
| `daily` | Everyone | Claim daily coins. |
| `transfer <user> <amount>` | Everyone | Move coins between accounts. |
| `baltop [page]` | Everyone | Richest members. |
| `premium` | Everyone | Show premium status and purchase info. |
| `economy adjust <user> <±amount> <reason>` | Admin | Manual correction, audited. |
| `premium grant <user> <days>` | Admin | Grant premium pass. |
| `cooldown reset <user>` | Admin | Reset economy cooldowns. |

Use Components V2 cards for balance/leaderboard. Ephemeral errors.

## 12. Earning triggers

Hooks should be best-effort (`.catch(() => undefined)`) and never block the primary action:

- Messages: after `activity.recordMessage`, award 1 SC with hourly cap.
- Commands: after successful `command.execute`, award 1 SC.
- Social: after `counters.increment`, award actor 2 SC with interaction idempotency key.
- Voice: periodic tick, award every 5 active minutes.
- Temp VC: small first-creation-per-day bonus (Temp VC itself remains free).
- Tambola: participation and win bonuses in Phase 4.
- Quests: objective progress in Phase 4.

## 13. Privacy and audit

- `PrivacyService.deleteUserData` must delete economy accounts, transactions, premium passes, quests, and inventory for that user.
- Flush and lock pending deltas before deletion to prevent resurrection.
- Admin adjustments and transfers above threshold write `audit_log` rows.
- MCP and Discord delete paths must match.

## 14. Abuse audit findings and mitigations

### Alt farming — High
- Reject self-target for all social interaction kinds.
- Per-user and per-pair daily caps.
- Diminishing returns.
- Minimum account/join age for rewards.
- Flag burst joins.
- Tests: self-interaction rejected; cap stops XP/count after limit; alt pair does not exceed daily cap.

### Spam — Medium
- Global token bucket per user.
- Dedupe repeated messages.
- Cap reaction increments.
- Persist cooldowns in Valkey.
- Tests: burst beyond bucket rejected; duplicate message counted once; cooldown survives restart where persisted.

### Voice AFK — Low
- AFK users still count for activity; only self-deafened/muted users may be excluded if configured.
- Reset pair timers on state change.
- Only award when both users are active.
- Tests: muted/AFK user accrues no time/XP; channel change resets accrual.

### Race conditions — Medium
- Per-guild serial queue for voice transitions.
- DB transactions with row locks for family/marriage/adopt.
- Idempotent flush with persisted last-flushed markers.
- Tests: concurrent marry has one winner; concurrent closePair adds no duplicate XP.

### Double spend / resurrection — High
- Comprehensive delete across all user tables.
- Flush and lock before delete.
- Clear pending deltas.
- Transactional delete.
- Tests: delete then flush does not resurrect; all user rows absent.

### Inflation — Medium
- Daily/season caps.
- Diminishing returns.
- Inactivity decay.
- Capped leaderboards.
- Tests: cap enforced; inactive rows decayed/purged.

### Privacy deletion — High
- Privacy text must list all stored data.
- Align MCP and Discord delete paths.
- Tests: full delete removes all user-linked rows.

### Audit logs — Medium
- Audit all state-changing commands.
- Validate/record real actor, not trusted `x-actor`.
- Restrict log purge with confirmation.
- Tests: admin mutation creates audit row; purge requires confirmation.

### Command gating bypass — Medium
- Centralize gating.
- Mark admin commands consistently with `adminOnly`.
- Persist cooldowns.
- Tests: non-admin prefix denied; admin metadata matches runtime checks.

### Moderator overrides — Medium
- Least-privilege moderator role.
- Require confirmation for destructive overrides.
- Audit real actor and reason.
- Tests: moderator cannot reset counters; override is audited.

## 15. Recommended test matrix

- Unit: self-target rejection, cooldown persistence, AFK exclusion, audit row creation.
- Integration: concurrent marry/adoption, concurrent voice flush, delete-then-flush no resurrection, full privacy delete.
- Load: spam burst caps, alt-pair daily cap, 100-user VC accrual correctness.
- Economy service: daily idempotency, transfer rollback on overdraft, concurrent transfers no lost updates, award idempotency key, leaderboard ordering.

## 16. Rollout

1. Phase 1: single balance + daily + work + streaks.
2. Phase 2: crime + gambling.
3. Phase 3: voice/music passive rewards + social rewards.
4. Phase 4: Tambola rewards + quests + gating/shop.

This keeps the economy additive: passive rewards feed sinks, sinks fund gating, and anti-farm rules remain consistent across all mechanics.
