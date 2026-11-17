// Dip-buy-and-hold BTC bot for agent-fun/bars-replay/v1.
//
// Strategy (long only, one position, $1,000 paper USDC, cbBTC/USDC, 1-minute bars):
//   - The dev window is a noisy random walk: every fast momentum / mean-reversion
//     rule I backtested on it lost money to the ~26 bps round-trip cost (4 bps fee,
//     2 bps modelled slippage, ~7 bps price impact), while buy-and-hold made
//     +$1.07 and the momentum baseline +$2.45. So this bot trades exactly once:
//     it buys the first meaningful dip, then holds to the end of the window.
//   - Entry: buy 100% of cash the first time the latest close falls at least
//     30 bps below the highest close seen so far (the running maximum). A dip
//     of that size is a normal pullback in this market (1-minute returns have
//     ~6 bps standard deviation), so the entry usually happens in the first
//     hour and buys the asset cheaper than the opening price.
//   - Fallback: if no 30 bps dip has appeared after 360 tradable batches
//     (6 hours), buy at the market anyway, so the bot never ends a window
//     with zero trades in a straight rally.
//   - Crash stop: after entering, sell the whole position if the latest close
//     falls 200 bps below the entry close. On the dev window this never fires
//     (the worst drawdown from entry is far smaller); it only caps a real
//     crash on the race window. No re-entry after the stop.
//   - Orders fill at the next bar's open, one bar after the decision, so all
//     decisions use closes already seen. max_slippage_bps is 200: the largest
//     one-minute move on the dev window is ~45 bps, so a fill is essentially
//     never rejected for slippage, while a violent gap still protects us.
//
// Determinism: every decision is a pure function of the bars and the account
// the harness sends. No wall clock, no environment, no files, no randomness,
// no network. All price math is exact bigint arithmetic on the harness's
// integer prices (price_scale 5), so the two graded executions agree exactly.
//
// Wire protocol: newline-delimited JSON on stdin/stdout, hello once, one
// batch per minute, one reply per batch echoing its seq, no reply to done.
// Implemented here directly on the protocol (standard library only), so this
// file is the whole bot: no vendored code, no dependencies, no install step.

import * as readline from 'node:readline';

// --- Tuned constants (chosen on the frozen dev window, see README) ---
const DIP_BPS = 30n; // buy once the close is this far below the running max
const FALLBACK_BATCHES = 360; // buy anyway after this many tradable batches
const STOP_BPS = 200n; // sell if the close falls this far below the entry close
const MAX_SLIPPAGE_BPS = 200; // bound on the move from the latest close
const BPS = 10_000n;

type Bar = {
  symbol: string;
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string | null;
  o_depth: string[];
  c_depth: string[];
};

type Position = { symbol: string; qty: string; cost_quote_units: string };
type Account = {
  cash_quote_units: string;
  positions: Position[];
  equity_quote_units: string;
};
type Batch = {
  type: 'batch';
  seq: number;
  t: number;
  bars: Bar[];
  fills: unknown[];
  account: Account;
};

// --- Bot state (all of it derived from the harness messages) ---
let symbol = 'CBBTC';
let warmupBars = 0;
let minNotional = 1_000_000n;
let maxWeightBps = 10_000n;
let tradableBatches = 0; // batches seen after the warm-up
let runMax: bigint | null = null; // highest close seen so far
let entryClose: bigint | null = null; // close at which the buy was decided
let buyPendingSeq: number | null = null; // seq of an unconfirmed buy order
let sellPendingSeq: number | null = null; // seq of an unconfirmed sell order
let stoppedOut = false; // the crash stop fired; never re-enter

function heldQty(account: Account): bigint {
  for (const p of account.positions) {
    if (p.symbol === symbol) return BigInt(p.qty);
  }
  return 0n;
}

function decide(batch: Batch): unknown[] {
  const account = batch.account;
  const cash = BigInt(account.cash_quote_units);
  const equity = BigInt(account.equity_quote_units);
  const held = heldQty(account);
  const warmingUp = batch.seq < warmupBars;

  // A pending order's fill (or rejection) is reflected in this batch's
  // account, one batch after it was sent: confirm it, or clear it so the
  // same rule can try again on the next batch.
  if (buyPendingSeq !== null && batch.seq > buyPendingSeq) {
    if (held > 0n) {
      buyPendingSeq = null; // buy filled; entryClose (decision close) stands
    } else {
      buyPendingSeq = null; // buy rejected: allow a fresh entry decision
      entryClose = null;
    }
  }
  if (sellPendingSeq !== null && batch.seq > sellPendingSeq) {
    sellPendingSeq = null; // filled (held is 0) or rejected (retry while the stop holds)
  }

  // Find this batch's close for our symbol; a minute with no bar is skipped.
  let close: bigint | null = null;
  for (const bar of batch.bars) {
    if (bar.symbol === symbol) {
      close = BigInt(bar.c);
      break;
    }
  }
  if (close === null || warmingUp) return [];
  tradableBatches += 1;
  if (runMax === null || close > runMax) runMax = close;

  // --- Exit: crash stop on a held position ---
  if (held > 0n && entryClose !== null && sellPendingSeq === null) {
    const dropBps = ((entryClose - close) * BPS) / entryClose;
    if (dropBps >= STOP_BPS) {
      stoppedOut = true;
      sellPendingSeq = batch.seq;
      return [
        {
          side: 'sell',
          client_id: `stop-${batch.seq}`,
          symbol,
          qty: held.toString(),
          max_slippage_bps: MAX_SLIPPAGE_BPS,
        },
      ];
    }
    return [];
  }

  // --- Entry: first 30 bps dip below the running max, or the fallback ---
  // entryClose is (re)set on every fresh buy decision and cleared if that
  // buy is rejected, so a rejection never blocks a retry.
  if (held === 0n && !stoppedOut && buyPendingSeq === null) {
    const dipBps = ((runMax - close) * BPS) / runMax;
    if (dipBps >= DIP_BPS || tradableBatches >= FALLBACK_BATCHES) {
      const byWeight = (maxWeightBps * equity) / BPS;
      const notional = cash < byWeight ? cash : byWeight;
      if (notional >= minNotional) {
        entryClose = close;
        buyPendingSeq = batch.seq;
        return [
          {
            side: 'buy',
            client_id: `dip-${batch.seq}`,
            symbol,
            notional_quote_units: notional.toString(),
            max_slippage_bps: MAX_SLIPPAGE_BPS,
          },
        ];
      }
    }
  }
  return [];
}

async function main(): Promise<void> {
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() === '') continue;
    const msg = JSON.parse(line) as Record<string, unknown>;
    if (msg.type === 'hello') {
      const hello = msg as unknown as {
        protocol: string;
        symbols: { symbol: string }[];
        warmup_bars?: number;
        capital: { quote_units: string };
        caps: { max_weight_bps: number };
        fees: { min_notional_quote_units: string };
      };
      if (hello.protocol !== 'agent-fun/bars-replay/v1') {
        throw new Error(`unsupported protocol ${String(hello.protocol)}`);
      }
      if (hello.symbols.length > 0) symbol = hello.symbols[0].symbol;
      warmupBars = hello.warmup_bars ?? 0;
      maxWeightBps = BigInt(hello.caps.max_weight_bps);
      minNotional = BigInt(hello.fees.min_notional_quote_units);
    } else if (msg.type === 'batch') {
      const batch = msg as unknown as Batch;
      const orders = decide(batch);
      process.stdout.write(
        JSON.stringify({ type: 'reply', seq: batch.seq, orders }) + '\n',
      );
    } else if (msg.type === 'done') {
      break;
    } else {
      throw new Error(`unknown message type ${String(msg.type)}`);
    }
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
