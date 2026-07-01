// Client-side backtester.
//
// PARITY: this runs the EXACT same decision function as the live engine
// (strategy.decide) on CLOSED candles. Higher timeframes (1H/4H) are rebuilt
// from the 15m series by resampling, and only fully-closed HTF candles are ever
// visible at each step (no look-ahead).
//
// LIMITATION (documented): Binance's public OI history doesn't reach far enough
// back, so OI confirmation isn't reproduced here. In strategy.ts OI is a scored
// factor (not a hard gate), so this only makes the backtest slightly more
// conservative than live, never more optimistic.

import { last } from "./indicators";
import { decide, type StrategyContext } from "./strategy";
import type { Candle } from "./types";

export interface BacktestParams {
  candles: Candle[];
  accountSize: number;
  riskPct: number;
  feeBps: number; // taker fee in basis points, charged per side
  slippageBps: number; // per side
  fundingRateAvg: number; // 8h funding, average
  rrTp1: number; // kept for UI compatibility (strategy uses 1.5 / 3.0 internally)
  rrTp2: number;
  minScore?: number; // defaults to 80
}

export interface BacktestTrade {
  openTime: number;
  closeTime: number;
  direction: "LONG" | "SHORT";
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  exit: number; // last (final) exit price of the position
  outcome: "TP1" | "TP2" | "STOP";
  pnl: number; // net USDT over the whole position
  rMultiple: number;
}

export interface BacktestResult {
  trades: BacktestTrade[];
  equity: { time: number; value: number }[];
  finalEquity: number;
  drawdown: number;
  maxDD: number;
  winrate: number;
  profitFactor: number;
  expectancy: number;
  avgWin: number;
  avgLoss: number;
  sharpe: number;
  sortino: number;
  // Added metrics (UI may ignore these safely):
  calmar?: number;
  maxConsecLosses?: number;
  tradesPerWeek?: number;
}

const HOUR = 3_600_000;
const FOUR_H = 14_400_000;

/** Aggregate 15m candles into a higher timeframe by time-bucketing. */
function resample(c15: Candle[], factorMs: number): Candle[] {
  const map = new Map<number, Candle>();
  const order: number[] = [];
  for (const c of c15) {
    const key = Math.floor(c.openTime / factorMs) * factorMs;
    const ex = map.get(key);
    if (!ex) {
      map.set(key, {
        openTime: key,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        closeTime: key + factorMs - 1,
      });
      order.push(key);
    } else {
      ex.high = Math.max(ex.high, c.high);
      ex.low = Math.min(ex.low, c.low);
      ex.close = c.close;
      ex.volume += c.volume;
    }
  }
  return order.map((k) => map.get(k)!);
}

interface OpenPos {
  direction: "LONG" | "SHORT";
  entry: number;
  stop: number; // moves to break-even after TP1
  tp1: number;
  tp2: number;
  sizeCoins: number; // full position size in coins
  remaining: number; // fraction still open (1 -> 0.5 after TP1 -> 0)
  tookTP1: boolean;
  openTime: number;
  openIdx: number;
  realizedPnl: number;
  lastExit: number;
}

export function runBacktest(p: BacktestParams): BacktestResult {
  const c = p.candles;
  const c1h = resample(c, HOUR);
  const c4h = resample(c, FOUR_H);
  const minScore = p.minScore ?? 80;

  const fee = p.feeBps / 10000;
  const slip = p.slippageBps / 10000;
  const riskAmount = (p.accountSize * p.riskPct) / 100;

  const W15 = 600; // rolling window: enough warmup for EMA200
  const WHTF = 400;
  const START = 260; // ensure EMA200 has history

  let p1 = -1; // pointer: last CLOSED 1h candle index <= current 15m closeTime
  let p4 = -1;

  const trades: BacktestTrade[] = [];
  let equity = p.accountSize;
  const equityCurve: { time: number; value: number }[] = [];
  let open: OpenPos | null = null;

  const dirSign = (d: "LONG" | "SHORT") => (d === "LONG" ? 1 : -1);

  function finalizeTrade(
    pos: OpenPos,
    outcome: "TP1" | "TP2" | "STOP",
    closeTime: number,
  ) {
    trades.push({
      openTime: pos.openTime,
      closeTime,
      direction: pos.direction,
      entry: pos.entry,
      stop: pos.stop,
      tp1: pos.tp1,
      tp2: pos.tp2,
      exit: pos.lastExit,
      outcome,
      pnl: pos.realizedPnl,
      rMultiple: riskAmount > 0 ? pos.realizedPnl / riskAmount : 0,
    });
  }

  /** Settle a fraction of the open position at exitPrice; mutate equity. */
  function settle(pos: OpenPos, fraction: number, exitPrice: number, closeTime: number) {
    const coins = pos.sizeCoins * fraction;
    const sign = dirSign(pos.direction);
    let pnl = (exitPrice - pos.entry) * sign * coins;
    const notionalEntry = pos.entry * coins;
    const notionalExit = exitPrice * coins;
    // round-trip fees + slippage on this fraction
    pnl -= (notionalEntry + notionalExit) * (fee + slip);
    // funding: longs pay positive funding, shorts receive it
    const hours = (closeTime - pos.openTime) / HOUR;
    const funding = notionalEntry * p.fundingRateAvg * (hours / 8);
    pnl -= pos.direction === "LONG" ? funding : -funding;
    equity += pnl;
    pos.realizedPnl += pnl;
    pos.lastExit = exitPrice;
  }

  for (let i = 0; i < c.length; i++) {
    const bar = c[i]!;
    while (p1 + 1 < c1h.length && c1h[p1 + 1]!.closeTime <= bar.closeTime) p1++;
    while (p4 + 1 < c4h.length && c4h[p4 + 1]!.closeTime <= bar.closeTime) p4++;

    // ---- Manage an open position (only from the bar AFTER entry) ----
    if (open && i > open.openIdx) {
      const dir = open.direction;
      const hitStop =
        dir === "LONG" ? bar.low <= open.stop : bar.high >= open.stop;
      const hitTP1 =
        !open.tookTP1 &&
        (dir === "LONG" ? bar.high >= open.tp1 : bar.low <= open.tp1);
      const hitTP2 = dir === "LONG" ? bar.high >= open.tp2 : bar.low <= open.tp2;

      let closed = false;
      // Conservative: if stop and target are in the same bar, assume stop first.
      if (hitStop) {
        settle(open, open.remaining, open.stop, bar.closeTime);
        open.remaining = 0;
        closed = true;
        finalizeTrade(open, open.tookTP1 ? "TP1" : "STOP", bar.closeTime);
      } else {
        if (hitTP1) {
          settle(open, 0.5, open.tp1, bar.closeTime);
          open.remaining = 0.5;
          open.tookTP1 = true;
          open.stop = open.entry; // move to break-even
        }
        if (hitTP2) {
          settle(open, open.remaining, open.tp2, bar.closeTime);
          open.remaining = 0;
          closed = true;
          finalizeTrade(open, "TP2", bar.closeTime);
        }
      }
      if (closed) open = null;
    }

    // ---- Look for a new entry when flat ----
    if (!open && i >= START) {
      const w15 = c.slice(Math.max(0, i - W15 + 1), i + 1);
      const w1 = c1h.slice(Math.max(0, p1 - WHTF + 1), p1 + 1);
      const w4 = c4h.slice(Math.max(0, p4 - WHTF + 1), p4 + 1);
      if (w15.length >= 210 && w1.length >= 60 && w4.length >= 60) {
        const ctx: StrategyContext = {
          candles15m: w15,
          candles1h: w1,
          candles4h: w4,
          price: bar.close,
          fundingRate: p.fundingRateAvg,
          openInterest: 0,
          oiHistory: [], // historical OI unavailable -> scored as 0 (conservative)
          longShortRatio: 1,
        };
        const res = decide(ctx, {
          minScore,
          accountSize: p.accountSize,
          riskPerTrade: p.riskPct,
          leverage: 1,
        });
        if (res.decision !== "NO_TRADE" && res.trade) {
          const t = res.trade;
          open = {
            direction: t.direction,
            entry: t.entry,
            stop: t.stop,
            tp1: t.tp1,
            tp2: t.tp2,
            sizeCoins: t.positionSize,
            remaining: 1,
            tookTP1: false,
            openTime: bar.openTime,
            openIdx: i,
            realizedPnl: 0,
            lastExit: t.entry,
          };
        }
      }
    }

    equityCurve.push({ time: bar.closeTime, value: equity });
  }

  // ---------- Stats ----------
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const winrate = trades.length ? (wins.length / trades.length) * 100 : 0;
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor =
    grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0;
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? -grossLoss / losses.length : 0;
  const expectancy = trades.length
    ? trades.reduce((s, t) => s + t.pnl, 0) / trades.length
    : 0;

  // Drawdown over the equity curve
  let peak = p.accountSize;
  let maxDD = 0;
  for (const pt of equityCurve) {
    if (pt.value > peak) peak = pt.value;
    const dd = ((peak - pt.value) / peak) * 100;
    if (dd > maxDD) maxDD = dd;
  }
  const drawdown =
    equityCurve.length > 0
      ? ((peak - (last(equityCurve)?.value ?? p.accountSize)) / peak) * 100
      : 0;

  // TIME-BASED Sharpe / Sortino on DAILY equity returns, annualized (crypto: 365d)
  const daily = toDailyReturns(equityCurve);
  const dMean = mean(daily);
  const dStd = std(daily, dMean);
  const dDown = std(
    daily.filter((r) => r < 0).map((r) => r),
    0,
  );
  const sharpe = dStd > 0 ? (dMean / dStd) * Math.sqrt(365) : 0;
  const sortino = dDown > 0 ? (dMean / dDown) * Math.sqrt(365) : 0;

  // Extra metrics
  const spanMs =
    equityCurve.length > 1
      ? equityCurve[equityCurve.length - 1]!.time - equityCurve[0]!.time
      : 0;
  const years = spanMs / (365 * 24 * HOUR);
  const cagr =
    years > 0 && p.accountSize > 0
      ? (Math.pow(equity / p.accountSize, 1 / years) - 1) * 100
      : 0;
  const calmar = maxDD > 0 ? cagr / maxDD : 0;
  const tradesPerWeek =
    spanMs > 0 ? trades.length / (spanMs / (7 * 24 * HOUR)) : 0;

  let maxConsecLosses = 0;
  let run = 0;
  for (const t of trades) {
    if (t.pnl <= 0) {
      run++;
      if (run > maxConsecLosses) maxConsecLosses = run;
    } else run = 0;
  }

  return {
    trades,
    equity: equityCurve,
    finalEquity: equity,
    drawdown,
    maxDD,
    winrate,
    profitFactor,
    expectancy,
    avgWin,
    avgLoss,
    sharpe,
    sortino,
    calmar,
    maxConsecLosses,
    tradesPerWeek,
  };
}

function toDailyReturns(curve: { time: number; value: number }[]): number[] {
  if (curve.length < 2) return [];
  const byDay = new Map<number, number>(); // day -> last equity that day
  for (const pt of curve) {
    const day = Math.floor(pt.time / (24 * HOUR));
    byDay.set(day, pt.value);
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);
  const eq = days.map((d) => byDay.get(d)!);
  const rets: number[] = [];
  for (let i = 1; i < eq.length; i++) {
    const prev = eq[i - 1]!;
    if (prev > 0) rets.push((eq[i]! - prev) / prev);
  }
  return rets;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function std(xs: number[], m: number): number {
  if (!xs.length) return 0;
  const mm = m || mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - mm) ** 2, 0) / xs.length);
}

/** Fetch enough 15m candles to cover N days from Binance. */
export async function fetchHistory(
  symbol: string,
  days: number,
): Promise<Candle[]> {
  const target = Math.ceil((days * 24 * 60) / 15);
  const out: Candle[] = [];
  let endTime = Date.now();
  while (out.length < target) {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=15m&limit=1500&endTime=${endTime}`;
    const res = await fetch(url);
    if (!res.ok) break;
    const raw = (await res.json()) as (string | number)[][];
    if (!raw.length) break;
    const batch: Candle[] = raw.map((k) => ({
      openTime: Number(k[0]),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
      closeTime: Number(k[6]),
    }));
    out.unshift(...batch);
    endTime = batch[0]!.openTime - 1;
    if (batch.length < 1500) break;
  }
  return out.slice(-target);
}
