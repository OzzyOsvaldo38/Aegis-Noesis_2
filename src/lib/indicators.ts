// Pure indicator math. All functions are deterministic and side-effect free.

import type { Candle } from "./types";

export function ema(values: number[], period: number): number[] {
  const out: number[] = [];
  if (!values.length) return out;
  const k = 2 / (period + 1);
  let prev = values[0]!;
  out.push(prev);
  for (let i = 1; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function rsi(closes: number[], period = 14): number[] {
  const out: number[] = new Array(closes.length).fill(NaN);
  if (closes.length < period + 1) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgG = gain / period;
  let avgL = loss / period;
  out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

export function atr(candles: Candle[], period = 14): number[] {
  const out: number[] = new Array(candles.length).fill(NaN);
  if (candles.length < period + 1) return out;
  const trs: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      trs.push(candles[0]!.high - candles[0]!.low);
      continue;
    }
    const c = candles[i]!;
    const p = candles[i - 1]!;
    trs.push(
      Math.max(
        c.high - c.low,
        Math.abs(c.high - p.close),
        Math.abs(c.low - p.close),
      ),
    );
  }
  let sum = 0;
  for (let i = 0; i < period; i++) sum += trs[i]!;
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < trs.length; i++) {
    prev = (prev * (period - 1) + trs[i]!) / period;
    out[i] = prev;
  }
  return out;
}

export function last<T>(arr: T[]): T | undefined {
  return arr[arr.length - 1];
}

/** Detect higher-highs / higher-lows or lower-highs / lower-lows on swing pivots. */
export function structure(
  candles: Candle[],
  lookback = 30,
): "BULL" | "BEAR" | "RANGE" {
  if (candles.length < lookback + 4) return "RANGE";
  const recent = candles.slice(-lookback);
  const highs: { i: number; v: number }[] = [];
  const lows: { i: number; v: number }[] = [];
  for (let i = 2; i < recent.length - 2; i++) {
    const c = recent[i]!;
    if (
      c.high > recent[i - 1]!.high &&
      c.high > recent[i - 2]!.high &&
      c.high > recent[i + 1]!.high &&
      c.high > recent[i + 2]!.high
    ) {
      highs.push({ i, v: c.high });
    }
    if (
      c.low < recent[i - 1]!.low &&
      c.low < recent[i - 2]!.low &&
      c.low < recent[i + 1]!.low &&
      c.low < recent[i + 2]!.low
    ) {
      lows.push({ i, v: c.low });
    }
  }
  if (highs.length < 2 || lows.length < 2) return "RANGE";
  const hh = highs[highs.length - 1]!.v > highs[highs.length - 2]!.v;
  const hl = lows[lows.length - 1]!.v > lows[lows.length - 2]!.v;
  const lh = highs[highs.length - 1]!.v < highs[highs.length - 2]!.v;
  const ll = lows[lows.length - 1]!.v < lows[lows.length - 2]!.v;
  if (hh && hl) return "BULL";
  if (lh && ll) return "BEAR";
  return "RANGE";
}

export function swingLow(candles: Candle[], lookback = 20): number {
  const slice = candles.slice(-lookback);
  return Math.min(...slice.map((c) => c.low));
}

export function swingHigh(candles: Candle[], lookback = 20): number {
  const slice = candles.slice(-lookback);
  return Math.max(...slice.map((c) => c.high));
}

export function avgVolume(candles: Candle[], period = 20): number {
  const slice = candles.slice(-period);
  if (!slice.length) return 0;
  return slice.reduce((s, c) => s + c.volume, 0) / slice.length;
}

/** Simple sweep / false-breakout detector on the last N candles. */
export function detectSweep(
  candles: Candle[],
  lookback = 20,
): { sweepHigh: boolean; sweepLow: boolean } {
  if (candles.length < lookback + 2)
    return { sweepHigh: false, sweepLow: false };
  const ref = candles.slice(-lookback - 2, -2);
  const hi = Math.max(...ref.map((c) => c.high));
  const lo = Math.min(...ref.map((c) => c.low));
  const a = candles[candles.length - 2]!;
  const b = candles[candles.length - 1]!;
  const sweepHigh = a.high > hi && b.close < hi; // wicked above, closed back
  const sweepLow = a.low < lo && b.close > lo;
  return { sweepHigh, sweepLow };
}

export function bodyRatio(c: Candle) {
  const range = c.high - c.low;
  if (range <= 0) return 0;
  return Math.abs(c.close - c.open) / range;
}