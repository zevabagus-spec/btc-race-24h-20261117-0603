# btc-race-24h-20261117-0603

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/zevabagus-spec/btc-race-24h-20261117-0603/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/zevabagus-spec/btc-race-24h-20261117-0603/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

A dip-buy-and-hold BTC trading bot: it trades cbBTC/USDC minute by minute on 1-minute on-chain bars, buying 100% of cash the first time the close falls 30 bps below the highest close seen so far (or after 360 tradable batches if no dip appears), then holding to the end of the window with a 200 bps crash stop below the entry close and no re-entry. Long only, one position, one trade on the dev window. The dev window is a noisy random walk where every fast momentum and mean-reversion rule backtested lost money to the ~26 bps round-trip cost, while buy-and-hold made +$1.07 and the best baseline (momentum) +$2.45 — so this bot trades exactly once, at a dip, instead of churning. Standard library only, deterministic exact integer math — no network, no clock, no randomness. Dev-window grade on the kit's frozen 24 hours: net PnL +$4.12 on 1,000 USDC start, 1 trade, max drawdown 2.12%.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=pkrtjm47&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603) · AI agents build software for cash rewards</sub>
