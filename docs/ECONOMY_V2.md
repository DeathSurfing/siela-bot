# Economy v2: earning, AI gating, and the Siela Exchange

Status: implemented, pending review. This document explains the choices behind the numbers in `docs/ECONOMY.md`. Design history lives in `docs/ECONOMY_PLAN.md` and `docs/CURRENCY_GATING.md`.

## 1. Goal and constraints

Siela Coins exist to gate the bot's expensive and scarce features, mostly Delulu. The server is a single guild of friends. That changes the design:

- The economy should reward hanging out, not grinding commands.
- No crime, robbery, rent, or taxes. Those punish friends who drift away.
- No player-run order book. One wealthy friend could corner it, and a thin market invites collusion.
- AI is the scarce resource. A wealthy player should not be able to run the GPU all day just because they have coins.
- The UI should feel native to Discord, not like a marketing embed.

The target is roughly 60–110 SC/day for an active member and 20–35 SC/day for a lurker. A typical day should fund a few AI uses, not unlimited use.

## 2. What the research said

The economy research looked at Dank Memer, UnbelievaBoat, MEE6, OwO, Tatsu, Poketwo, and open-source bots. The useful patterns:

- One daily anchor plus a few short actions. MEE6 pairs a 24h daily with 1h work; UnbelievaBoat uses 4h work and crime. Too many timers turn the bot into a chore.
- Hard caps on chat income. UnbelievaBoat's default chat payout can theoretically reach thousands per day; a small server needs a cap far below that.
- Cosmetic and status sinks fit friend groups better than power sinks. Paid roles, titles, and collectibles do not create a power imbalance.
- Gambling should be a sink, not a faucet. Dank Memer removed gambling after it minted large amounts of currency.
- Measure supply. Dank Memer publishes coin supply and item quantity, and changes one faucet or price at a time.

The stock research looked at Neopets, RuneScape, Animal Crossing, classroom stock games, and Discord stock bots. The useful patterns:

- A player-driven order book needs liquidity that a 10–50 person server does not have.
- A bot market maker with a quoted price is fair and hard to manipulate.
- Weak mean reversion plus event jumps creates stories without letting one player move the price.
- Daily or hourly cadence both work. The research preferred a daily close for fairness across time zones; this bot chose hourly because the group checks chat often and the card shows the last tick.
- No shorting, no limit orders, and no peer-to-peer share transfers at launch. They add complexity and abuse cases before the core loop is proven.

Both reports note that no public bot documents a balance tuned for 10–50 daily active users. The numbers here are inference from documented defaults, not a benchmark.

## 3. Faucets

| Source | Payout | Limit | Why it exists |
|---|---:|---|---|
| Starting balance | 50 SC | Once per account | A new member can buy a cheap stock or try a few AI uses on day one. |
| Daily | 10–70 SC | 24h cooldown, 36h streak window | The anchor. Missing a day does not erase weeks of progress. |
| Work | 3–8 SC | 2h cooldown | A short action with a little randomness. |
| Voice | 1 SC per 10 min | 20/day | Rewards hanging out. AFK, self-deafened, and self-muted members are excluded. |
| Social commands | 1 SC | 20/day | Rewards the bot's social features without rewarding spam. |
| Any successful command | 1 SC | 5/hour | A small thank-you for using the bot. |
| Tambola | 5 participation, 10 per line, 40 Full House | Per game, at least 10 numbers called | Makes the social event net-positive for players instead of a pure sink. |
| Exchange | Capital gains after the 1% sell fee | None per player | A skill-and-luck game, not a guaranteed income. |
| Transfers | 1–1,000,000 SC | No daily cap | Friends can share. The lack of a cap is documented as a known gap. |

## 4. Sinks

| Sink | Cost | Why |
|---|---:|---|
| Delulu SFW | 5, 10, 20, 40 SC | Surge pricing doubles per daily use. Four uses cost 75 SC total. |
| Delulu NSFW | 15, 30, 60, ... SC | Uncapped; surge pricing doubles per daily use. Coins are the only limit. |
| Tambola extra ticket | 25 SC | Optional extra chances. |
| Tambola auto-mark | 10 SC | Convenience. |
| Premium | 2,000 SC / 30 days | A long-term status goal. Premium is status-only. |
| Gambling | 4% coinflip edge, 3.2% slots edge | A sink, not a way to get rich. |
| Exchange fee | 1% per side, minimum 1 SC | Pays for market making and removes a little supply on every trade. |
| Shop items | Admin-set | Roles and cosmetics. |

## 5. The AI gate

The old gate was a flat 5 SC / 15 SC. A active member could earn enough for many uses, and a wealthy member could run the model without limit. The new gate has two parts:

1. The price doubles with each use that day. SFW: 5, 10, 20, 40 (capped at 4 uses/day). NSFW: 15, 30, 60, ... (no daily cap).
2. A hard daily cap. SFW stops at four uses; NSFW stops at two.

A failed generation is refunded and does not consume a use. The usage query subtracts refunded transactions by payment ID, so a model failure does not silently burn the daily quota.

The economics: four SFW uses cost 75 SC. A typical active day earns 60–110 SC, so the cap and the price land in the same range. The cap is the ceiling; the price is the budget.

## 6. The exchange

`stocks` is a bot market maker. The bot quotes a price and is the counterparty for every trade. Players cannot trade shares with each other, short, or place limit orders.

- Six tickers: `SIELA`, `DELULU`, `TAMB`, `KIT`, `YAP`, `CHODU`. The names are server in-jokes.
- Prices update hourly. A read or trade catches up missed ticks, capped at 24 ticks per catch-up.
- Each tick applies a weak pull toward a slow-moving fair value, a volatility kick, and a small chance of a headline event.
- The fee is 1% per side, minimum 1 SC. A round trip costs about 2%.
- Buys use a weighted average cost that includes the buy fee. Sells report realized P/L against that average.
- The market board shows a 12-tick sparkline, the equal-weight `SIELA-6` index, and the latest headline.
- The portfolio is ephemeral. The market board is public. Buy and sell open a modal from the card or accept `stocks buy <symbol> <shares>` and `stocks sell <symbol> <shares>`.

A 30-day simulation of 720 hourly ticks across 2,000 runs per ticker showed the index roughly flat, with the high-volatility tickers losing a little to volatility drag. That is acceptable: the exchange is a game and a sink, not a money printer. The 1% fee is the explicit sink.

## 7. UI rules

The repository already has a shared Components V2 kit (`features/ui.ts`) and a UI audit (`docs/UI_AUDIT.md`). The new surfaces follow it:

- One accent color for normal cards. Success and danger are semantic, not decorative.
- The market board is public and compact. One title, one index line, one row per ticker, one action row.
- The portfolio and trade replies are ephemeral. Money screens are private by default.
- Buy and sell use modals. The command path exists for power users and tests.
- The blackjack card now uses the shared kit instead of its own container and accent.
- The economy leaderboard paginates the top 100 and uses medals for the top three.
- Confirmation, success, error, and empty states reuse the shared helpers.

## 8. Deliberately not built

- A player order book. Too thin at this scale.
- Shorting and limit orders. Complexity and unlimited-loss edge cases.
- Peer-to-peer share transfers. Wealth transfer and wash-trade risk.
- Crime, robbery, rent, and taxes. Wrong tone for a friend group.
- Quests and chat-message income. Good next steps, but they need event tracking and a separate tuning pass.
- A global daily earn cap. Each source has its own cap; a global cap is easy to add once `economy stats` shows real volumes.
- A market wipe or reset. The research is clear that wipes destroy trust. Tune faucets instead.

## 9. Tuning and observability

- `economy stats` shows the last 7 days of transaction volume by kind.
- Change one faucet or one price at a time. Compare the next week's totals.
- Watch the ratio of `daily` and `work` mints to `delulu`, gambling, and `stock_buy` burns.
- If the AI gate is too loose, raise the base price before adding another cap. If it is too tight, lower the base or widen the cap.
- If the exchange is too swingy, lower the volatility of the high-beta tickers before changing the fee. The fee is the sink; volatility is the feel.

## 10. Open questions

- Should transfers have a small fee or a daily cap? The research warns about funneling; the friends-only setting makes it low risk.
- Should the market tick daily instead of hourly? Daily is fairer across time zones; hourly is more fun in an active chat.
- Should Tambola rewards scale with the number of players or ticket count? The current flat rewards are simple but may overpay tiny games.
- Should premium do something mechanical? It is currently status-only.

## 11. Sources

- Dank Memer, inflation: https://dankmemer.lol/blogs/inflation
- Dank Memer, gambling nerf: https://dankmemer.lol/blogs/gambling-was-nerfed
- MEE6 economy: https://help.mee6.xyz/en/articles/604799-mee6-economy-plugin-features-and-limitations
- UnbelievaBoat defaults: https://faq.unbelievaboat.com/getting-started/configuring/
- Tatsu economy: https://tatsu.gg/economy
- Poketwo spawning: https://docs.poketwo.net/basics/spawning-and-catching
- Jellyneo, Neopian stock market: https://www.jellyneo.net/?go=neopian_stock_market
- OSRS Wiki, Grand Exchange: https://oldschool.runescape.wiki/w/Grand_Exchange
- Nookipedia, Stalk Market: https://nookipedia.com/wiki/Stalk_Market
- WabbitBot stock market: https://wabbit.gg/discord-stock-market-bot
- FINRA, pump-and-dump: https://www.finra.org/investors/insights/pump-and-dump-scams
- Discord components: https://discord.com/developers/docs/components/overview
