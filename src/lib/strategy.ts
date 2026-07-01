// SINGLE SOURCE OF TRUTH for the trading decision.
// Used by BOTH the live engine (engine.ts) and the backtester (backtest.ts),
// so that backtest metrics describe EXACTLY the strategy that is traded live.
//
// Hard guarantees:
//  - Operates ONLY on CLOSED candles. The caller must pass arrays whose last
//    element is the most recently *closed* candle of that timeframe. This kills
//    the previous repaint bug (engine used the still-forming 15m candle).
//  - Pure & deterministic: no I/O, no Date.now-dependent logic except the ts stamp.
//
// Note on OI/Funding: historical Open-Interest is not available far enough back
// from Binance's public endpoint, so OI confirmation can't be reproduced in the
// backtest. To keep ONE code path, OI is a *scored* factor only (not a hard gate).
// Funding was already scored-only. This also reduces brittleness of the live gate.

import {
  atr,
  avgVolume,
  bodyRatio,
  detectSweep,
  ema,
  last,
  rsi,
  structure,
  swingHigh,
  swingLow,
} from "./indicators";
import type {
  Candle,
  Direction,
  EngineResult,
  LayerResult,
} from "./types";

export interface StrategyConfig {
  minScore: number;
  accountSize: number; // USDT
  riskPerTrade: number; // %
  leverage: number;
}

export interface StrategyContext {
  // Each array ends on the most recently CLOSED candle of that timeframe.
  candles15m: Candle[];
  candles1h: Candle[];
  candles4h: Candle[];
  price: number; // close of the last closed 15m candle
  fundingRate: number;
  openInterest: number;
  oiHistory: { time: number; value: number }[];
  longShortRatio: number;
}

function trendOf(candles: Candle[]): {
  dir: Direction | "NONE";
  ema20: number;
  ema50: number;
  ema200: number;
  rising: boolean;
  falling: boolean;
} {
  const closes = candles.map((c) => c.close);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const ema20 = last(e20) ?? 0;
  const ema50 = last(e50) ?? 0;
  const ema200 = last(e200) ?? 0;
  const ema200Prev = e200[e200.length - 6] ?? ema200;
  const rising = ema200 > ema200Prev * 1.0005;
  const falling = ema200 < ema200Prev * 0.9995;
  const price = closes[closes.length - 1] ?? 0;
  let dir: Direction | "NONE" = "NONE";
  if (price > ema200 && rising && ema20 > ema50) dir = "LONG";
  else if (price < ema200 && falling && ema20 < ema50) dir = "SHORT";
  return { dir, ema20, ema50, ema200, rising, falling };
}

function manipulationScore(candles15: Candle[]): {
  score: number;
  notes: string[];
} {
  const notes: string[] = [];
  let score = 0;
  const sweep = detectSweep(candles15, 20);
  if (sweep.sweepHigh) {
    score += 30;
    notes.push("Liquidity-Sweep über letztes Hoch");
  }
  if (sweep.sweepLow) {
    score += 30;
    notes.push("Liquidity-Sweep unter letztes Tief");
  }
  // Long-wick / false-breakout on the last CLOSED candle.
  const lastClosed = candles15[candles15.length - 1];
  if (lastClosed) {
    const br = bodyRatio(lastClosed);
    if (br < 0.25) {
      score += 15;
      notes.push("Großer Wick — möglicher Stop-Hunt");
    }
    const av = avgVolume(candles15, 20);
    if (av > 0 && lastClosed.volume > av * 3) {
      score += 15;
      notes.push("Volumen-Spike (>3× Ø)");
    }
  }
  // Recent very wide range (volatility burst).
  const a = atr(candles15, 14);
  const lastAtr = last(a) ?? 0;
  const prevAtr = a[a.length - 6] ?? lastAtr;
  if (prevAtr > 0 && lastAtr > prevAtr * 1.8) {
    score += 10;
    notes.push("ATR-Spike — erhöhte Volatilität");
  }
  return { score: Math.min(100, score), notes };
}

export function decide(
  ctx: StrategyContext,
  cfg: StrategyConfig,
): EngineResult {
  const reasoning: string[] = [];
  const layers: LayerResult[] = [];

  const t4 = trendOf(ctx.candles4h);
  const t1 = trendOf(ctx.candles1h);
  const t15 = trendOf(ctx.candles15m);

  const closes15 = ctx.candles15m.map((c) => c.close);
  const rsiArr = rsi(closes15, 14);
  const rsi15 = last(rsiArr) ?? 50;
  const atrArr = atr(ctx.candles15m, 14);
  const atr15 = last(atrArr) ?? 0;
  const price = ctx.price;

  // ---- Layer 1: TREND (4H + 1H must align) ----
  let trendDir: Direction | "NONE" = "NONE";
  if (t4.dir === "LONG" && t1.dir === "LONG") trendDir = "LONG";
  else if (t4.dir === "SHORT" && t1.dir === "SHORT") trendDir = "SHORT";
  layers.push({
    name: "Trend",
    status: trendDir === "NONE" ? "FAIL" : "PASS",
    detail:
      trendDir === "NONE"
        ? "4H/1H nicht ausgerichtet"
        : `4H + 1H ${trendDir === "LONG" ? "bullisch" : "bärisch"}`,
  });

  // ---- Layer 2: STRUCTURE on 1H ----
  const struct = structure(ctx.candles1h, 40);
  const structOk =
    (trendDir === "LONG" && struct === "BULL") ||
    (trendDir === "SHORT" && struct === "BEAR");
  layers.push({
    name: "Struktur",
    status: structOk ? "PASS" : trendDir === "NONE" ? "NEUTRAL" : "FAIL",
    detail:
      struct === "BULL"
        ? "HH/HL"
        : struct === "BEAR"
          ? "LH/LL"
          : "Range / unklar",
  });

  // ---- Layer 3: ENTRY on 15M (last CLOSED candle) ----
  const lastClose = closes15[closes15.length - 1] ?? price;
  const lastCandle = ctx.candles15m[ctx.candles15m.length - 1];
  const bullCandle = lastCandle ? lastCandle.close > lastCandle.open : false;
  const pullbackLong =
    lastClose <= t15.ema20 * 1.005 && lastClose >= t15.ema50 * 0.995;
  const pullbackShort =
    lastClose >= t15.ema20 * 0.995 && lastClose <= t15.ema50 * 1.005;
  const rsiOkLong = rsi15 >= 50 && rsi15 <= 70;
  const rsiOkShort = rsi15 >= 30 && rsi15 <= 50;
  const av = avgVolume(ctx.candles15m, 5);
  const lastVol = lastCandle ? lastCandle.volume : 0;
  const volOk = av > 0 ? lastVol > av : false;
  const oiRising =
    ctx.oiHistory.length >= 2
      ? ctx.oiHistory[ctx.oiHistory.length - 1]!.value >
        ctx.oiHistory[0]!.value
      : false;
  const fundingNeutral = Math.abs(ctx.fundingRate) < 0.0005;
  const fundingSlightLong =
    ctx.fundingRate >= -0.0005 && ctx.fundingRate <= 0.0008;
  const fundingSlightShort =
    ctx.fundingRate <= 0.0005 && ctx.fundingRate >= -0.0008;

  let entryOk = false;
  if (trendDir === "LONG") {
    entryOk = pullbackLong && bullCandle && rsiOkLong;
  } else if (trendDir === "SHORT") {
    entryOk = pullbackShort && !bullCandle && rsiOkShort;
  }
  layers.push({
    name: "Entry",
    status: entryOk ? "PASS" : trendDir === "NONE" ? "NEUTRAL" : "FAIL",
    detail: entryOk
      ? "Pullback + Bestätigungskerze + RSI-Zone"
      : "Kein gültiger Pullback / Bestätigung",
  });

  // ---- Layer 4: MANIPULATION ----
  const manip = manipulationScore(ctx.candles15m);
  const manipBlock = manip.score > 75;
  layers.push({
    name: "Manipulation",
    status: manipBlock ? "FAIL" : manip.score > 40 ? "WARN" : "PASS",
    detail: manip.notes.length
      ? manip.notes.join(" · ")
      : "Keine Auffälligkeiten",
  });

  // ---- Layer 5: RISK ----
  let stop = 0;
  let entry = price;
  let tp1 = 0;
  let tp2 = 0;
  let positionSize = 0;
  let riskAmount = 0;
  let crv = 0;
  let crvOk = false;
  let stopValid = false;

  if (trendDir !== "NONE") {
    if (trendDir === "LONG") {
      stop = swingLow(ctx.candles15m.slice(-25), 25);
      stop = Math.min(stop, price - atr15 * 1.0);
    } else {
      stop = swingHigh(ctx.candles15m.slice(-25), 25);
      stop = Math.max(stop, price + atr15 * 1.0);
    }
    const stopDist = Math.abs(price - stop);
    stopValid = stopDist > atr15 * 0.4 && stopDist < atr15 * 4;
    riskAmount = (cfg.accountSize * cfg.riskPerTrade) / 100;
    positionSize = stopDist > 0 ? riskAmount / stopDist : 0;
    if (trendDir === "LONG") {
      tp1 = price + stopDist * 1.5;
      tp2 = price + stopDist * 3;
    } else {
      tp1 = price - stopDist * 1.5;
      tp2 = price - stopDist * 3;
    }
    // CRV now COMPUTED from the actual levels instead of hardcoded.
    crv = stopDist > 0 ? Math.abs(tp1 - entry) / stopDist : 0;
    crvOk = stopValid && crv >= 1.5 - 1e-9;
  }

  layers.push({
    name: "Risk",
    status: stopValid ? "PASS" : trendDir === "NONE" ? "NEUTRAL" : "FAIL",
    detail: stopValid
      ? `SL ${stop.toFixed(2)} · CRV ${crv.toFixed(2)}`
      : "Stop ungültig (ATR-Verhältnis)",
  });

  // ---- Score 0..100 ----
  const scores = {
    trend: trendDir !== "NONE" ? 20 : 0,
    structure: structOk ? 15 : 0,
    entry: entryOk ? 10 : 0,
    volume: volOk ? 10 : 0,
    rsi:
      trendDir === "LONG" && rsiOkLong
        ? 5
        : trendDir === "SHORT" && rsiOkShort
          ? 5
          : 0,
    oi: oiRising ? 10 : 0,
    funding:
      trendDir === "LONG" && (fundingNeutral || fundingSlightLong)
        ? 5
        : trendDir === "SHORT" && (fundingNeutral || fundingSlightShort)
          ? 5
          : 0,
    manipulation: Math.max(0, 10 - Math.round(manip.score / 10)),
    risk: stopValid ? 10 : 0,
    crv: crvOk ? 5 : 0,
  };
  const totalScore =
    scores.trend +
    scores.structure +
    scores.entry +
    scores.volume +
    scores.rsi +
    scores.oi +
    scores.funding +
    scores.manipulation +
    scores.risk +
    scores.crv;

  // ---- Layer 6: DECISION ----
  // OI removed from the HARD gate (data not reproducible historically); it stays
  // a scored factor. Everything else identical to the original gate.
  const allOk =
    trendDir !== "NONE" &&
    structOk &&
    entryOk &&
    volOk &&
    (trendDir === "LONG" ? rsiOkLong : rsiOkShort) &&
    !manipBlock &&
    stopValid &&
    crvOk;

  let decision: EngineResult["decision"] = "NO_TRADE";
  if (allOk && totalScore >= 90) decision = "STRONG_SIGNAL";
  else if (allOk && totalScore >= cfg.minScore) decision = "SIGNAL";

  layers.push({
    name: "Decision",
    status: decision === "NO_TRADE" ? "FAIL" : "PASS",
    detail:
      decision === "NO_TRADE"
        ? "Default — keine Position"
        : `Signal Score ${totalScore}`,
  });

  reasoning.push(
    trendDir === "NONE"
      ? "Trend nicht eindeutig — kein Trade."
      : `Trend ${trendDir} (4H + 1H ausgerichtet).`,
  );
  reasoning.push(
    structOk
      ? `Struktur bestätigt (${struct === "BULL" ? "HH/HL" : "LH/LL"}).`
      : "Struktur nicht bestätigt.",
  );
  reasoning.push(
    entryOk
      ? "Entry-Setup auf 15M sauber."
      : "Kein sauberer 15M-Entry vorhanden.",
  );
  reasoning.push(
    `Manipulation Score ${manip.score}/100${manipBlock ? " — BLOCKIERT" : ""}.`,
  );
  reasoning.push(
    stopValid
      ? "Risk-Layer ok, Stop ATR-validiert."
      : "Risk-Layer fehlgeschlagen.",
  );

  const result: EngineResult = {
    ts: Date.now(),
    price,
    direction: trendDir,
    decision,
    score: totalScore,
    scores,
    manipulationScore: manip.score,
    layers,
    reasoning,
    market: {
      fundingRate: ctx.fundingRate,
      openInterest: ctx.openInterest,
      oiChangePct:
        ctx.oiHistory.length >= 2
          ? ((ctx.oiHistory[ctx.oiHistory.length - 1]!.value -
              ctx.oiHistory[0]!.value) /
              ctx.oiHistory[0]!.value) *
            100
          : 0,
      longShortRatio: ctx.longShortRatio,
      rsi15m: rsi15,
      atr15m: atr15,
      ema20: t15.ema20,
      ema50: t15.ema50,
      ema200: t15.ema200,
    },
  };

  if (decision !== "NO_TRADE" && trendDir !== "NONE") {
    result.trade = {
      direction: trendDir,
      entry,
      stop,
      tp1,
      tp2,
      riskAmount,
      positionSize,
      leverage: cfg.leverage,
      crv,
    };
  }

  return result;
}
