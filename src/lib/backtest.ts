// Client-side backtester over historical 15m candles.
// Includes fees, slippage and funding cost estimate.

import { ema, rsi, atr, structure, last } from "./indicators";
import type { Candle } from "./types";

export interface BacktestParams {
  candles: Candle[];
  accountSize: number;
  riskPct: number;
  feeBps: number; // taker fee in basis points (round-trip applied)
  slippageBps: number;
  fundingRateAvg: number; // 8h funding, avg
  rrTp1: number;
  rrTp2: number;
}

export interface BacktestTrade {
  openTime: number;
  closeTime: number;
  direction: "LONG" | "SHORT";
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  exit: number;
  outcome: "TP1" | "TP2" | "STOP";
  pnl: number;
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
}

export function runBacktest(p: BacktestParams): BacktestResult {
  const c = p.candles;
  const closes = c.map((x) => x.close);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const r = rsi(closes, 14);
  const a = atr(c, 14);

  const trades: BacktestTrade[] = [];
  let equity = p.accountSize;
  const equityCurve: { time: number; value: number }[] = [];
  let openTrade: BacktestTrade | null = null;
  let openSizeUSD = 0;

  const fee = p.feeBps / 10000;
  const slip = p.slippageBps / 10000;

  for (let i = 220; i < c.length; i++) {
    const candle = c[i]!;
    if (openTrade) {
      const hitStop =
        openTrade.direction === "LONG"
          ? candle.low <= openTrade.stop
          : candle.high >= openTrade.stop;
      const hitTp2 =
        openTrade.direction === "LONG"
          ? candle.high >= openTrade.tp2
          : candle.low <= openTrade.tp2;
      const hitTp1 =
        openTrade.direction === "LONG"
          ? candle.high >= openTrade.tp1
          : candle.low <= openTrade.tp1;
      let exit = 0;
      let outcome: "TP1" | "TP2" | "STOP" | null = null;
      if (hitStop) {
        exit = openTrade.stop;
        outcome = "STOP";
      } else if (hitTp2) {
        exit = openTrade.tp2;
        outcome = "TP2";
      } else if (hitTp1) {
        exit = openTrade.tp1;
        outcome = "TP1";
      }
      if (outcome) {
        const dir = openTrade.direction === "LONG" ? 1 : -1;
        const gross = (exit - openTrade.entry) * dir;
        const stopDist = Math.abs(openTrade.entry - openTrade.stop);
        const rMultiple = stopDist > 0 ? gross / stopDist : 0;
        // PnL on risk basis: risk * R - fees - funding
        const riskAmount = (p.accountSize * p.riskPct) / 100;
        let pnl = riskAmount * rMultiple;
        const feesUSD = openSizeUSD * fee * 2 + openSizeUSD * slip * 2;
        const hours = (candle.closeTime - openTrade.openTime) / 3600000;
        const fundingCost = (openSizeUSD * p.fundingRateAvg * hours) / 8;
        pnl -= feesUSD;
        pnl -=
          openTrade.direction === "LONG" ? fundingCost : -fundingCost;
        equity += pnl;
        openTrade.exit = exit;
        openTrade.outcome = outcome;
        openTrade.closeTime = candle.closeTime;
        openTrade.pnl = pnl;
        openTrade.rMultiple = rMultiple;
        trades.push(openTrade);
        openTrade = null;
        openSizeUSD = 0;
      }
    }

    if (!openTrade) {
      const ema20 = e20[i];
      const ema50 = e50[i];
      const ema200 = e200[i];
      const rsiNow = r[i];
      const atrNow = a[i];
      if (
        ema20 == null ||
        ema50 == null ||
        ema200 == null ||
        rsiNow == null ||
        atrNow == null ||
        Number.isNaN(rsiNow) ||
        Number.isNaN(atrNow)
      )
        continue;
      const slice = c.slice(i - 60, i + 1);
      const struct = structure(slice, 40);
      const price = candle.close;
      let dir: "LONG" | "SHORT" | null = null;
      if (
        price > ema200 &&
        ema20 > ema50 &&
        struct === "BULL" &&
        rsiNow >= 50 &&
        rsiNow <= 70 &&
        Math.abs(price - ema20) < ema20 * 0.004
      )
        dir = "LONG";
      else if (
        price < ema200 &&
        ema20 < ema50 &&
        struct === "BEAR" &&
        rsiNow >= 30 &&
        rsiNow <= 50 &&
        Math.abs(price - ema20) < ema20 * 0.004
      )
        dir = "SHORT";
      if (dir) {
        const stop =
          dir === "LONG"
            ? price - atrNow * 1.2
            : price + atrNow * 1.2;
        const stopDist = Math.abs(price - stop);
        const tp1 = dir === "LONG" ? price + stopDist * p.rrTp1 : price - stopDist * p.rrTp1;
        const tp2 = dir === "LONG" ? price + stopDist * p.rrTp2 : price - stopDist * p.rrTp2;
        const riskAmount = (p.accountSize * p.riskPct) / 100;
        const sizeCoins = stopDist > 0 ? riskAmount / stopDist : 0;
        openSizeUSD = sizeCoins * price;
        openTrade = {
          openTime: candle.openTime,
          closeTime: 0,
          direction: dir,
          entry: price,
          stop,
          tp1,
          tp2,
          exit: 0,
          outcome: "STOP",
          pnl: 0,
          rMultiple: 0,
        };
      }
    }
    equityCurve.push({ time: candle.closeTime, value: equity });
  }

  // Stats
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const winrate = trades.length ? (wins.length / trades.length) * 100 : 0;
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0;
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? -grossLoss / losses.length : 0;
  const expectancy = trades.length
    ? trades.reduce((s, t) => s + t.pnl, 0) / trades.length
    : 0;

  // Drawdown
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

  // Sharpe / Sortino on per-trade returns
  const returns = trades.map((t) => t.pnl / p.accountSize);
  const mean = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const std = returns.length
    ? Math.sqrt(
        returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length,
      )
    : 0;
  const downside = returns.filter((r) => r < 0);
  const stdDown = downside.length
    ? Math.sqrt(downside.reduce((s, r) => s + r ** 2, 0) / downside.length)
    : 0;
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(returns.length) : 0;
  const sortino = stdDown > 0 ? (mean / stdDown) * Math.sqrt(returns.length) : 0;

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
  };
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