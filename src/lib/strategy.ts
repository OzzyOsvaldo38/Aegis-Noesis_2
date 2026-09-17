// SINGLE SOURCE OF TRUTH for the trading decision.
//
// Used by BOTH the live engine (engine.ts) and the backtester (backtest.ts).
//
// Architecture:
//   4H regime → 1H trend/structure → 15M entry → liquidity risk → risk/CRV
//
// Important:
// - Only CLOSED candles may be passed to decide().
// - NO_TRADE is the default.
// - Hard filters cannot be overridden by the score.
// - OI and funding are scored factors only.
// - No I/O, no API calls, no database access.
// - The engine is responsible for external data-health validation.

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
  NoTradeReason,
  NoTradeReasonCode,
} from "./types";

export interface StrategyConfig {
  minScore: number;
  accountSize: number;
  riskPerTrade: number;
  leverage: number;
}

export interface StrategyContext {
  // Every array must end with the most recently CLOSED candle.
  candles15m: Candle[];
  candles1h: Candle[];
  candles4h: Candle[];

  // Close of the most recently closed 15M candle.
  price: number;

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

  // Compare against a previous closed value.
  const ema200Prev = e200[e200.length - 6] ?? ema200;

  const rising = ema200 > ema200Prev * 1.0005;
  const falling = ema200 < ema200Prev * 0.9995;

  const price = closes[closes.length - 1] ?? 0;

  let dir: Direction | "NONE" = "NONE";

  if (price > ema200 && rising && ema20 > ema50) {
    dir = "LONG";
  } else if (price < ema200 && falling && ema20 < ema50) {
    dir = "SHORT";
  }

  return {
    dir,
    ema20,
    ema50,
    ema200,
    rising,
    falling,
  };
}

function liquidityRiskScore(candles15: Candle[]): {
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

  const lastClosed = candles15[candles15.length - 1];

  if (lastClosed) {
    const br = bodyRatio(lastClosed);

    if (br < 0.25) {
      score += 15;
      notes.push("Großer Wick — erhöhtes Liquidity-Risk");
    }

    const av = avgVolume(candles15, 20);

    if (av > 0 && lastClosed.volume > av * 3) {
      score += 15;
      notes.push("Volumen-Spike (>3× Durchschnitt)");
    }
  }

  const atrValues = atr(candles15, 14);
  const lastAtr = last(atrValues) ?? 0;
  const previousAtr = atrValues[atrValues.length - 6] ?? lastAtr;

  if (previousAtr > 0 && lastAtr > previousAtr * 1.8) {
    score += 10;
    notes.push("ATR-Spike — erhöhte Volatilität");
  }

  return {
    score: Math.min(100, score),
    notes,
  };
}

function makeReason(
  code: NoTradeReasonCode,
  message: string,
  blocking = true,
): NoTradeReason {
  return {
    code,
    message,
    blocking,
  };
}

function createDataHealth(timestamp: number) {
  return {
    status: "HEALTHY" as const,
    checks: [],
    timestamp,
  };
}

export function decide(
  ctx: StrategyContext,
  cfg: StrategyConfig,
): EngineResult {
  const ts = Date.now();

  const reasoning: string[] = [];
  const layers: LayerResult[] = [];
  const noTradeReasons: NoTradeReason[] = [];

  const t4 = trendOf(ctx.candles4h);
  const t1 = trendOf(ctx.candles1h);
  const t15 = trendOf(ctx.candles15m);

  const closes15 = ctx.candles15m.map((c) => c.close);

  const rsiValues = rsi(closes15, 14);
  const rsi15 = last(rsiValues) ?? 50;

  const atrValues = atr(ctx.candles15m, 14);
  const atr15 = last(atrValues) ?? 0;

  const price = ctx.price;

  // ------------------------------------------------------------
  // LAYER 1 — TREND
  // ------------------------------------------------------------

  let trendDir: Direction | "NONE" = "NONE";

  if (t4.dir === "LONG" && t1.dir === "LONG") {
    trendDir = "LONG";
  } else if (t4.dir === "SHORT" && t1.dir === "SHORT") {
    trendDir = "SHORT";
  }

  layers.push({
    name: "Trend",
    status: trendDir === "NONE" ? "FAIL" : "PASS",
    detail:
      trendDir === "NONE"
        ? "4H/1H nicht ausgerichtet"
        : trendDir === "LONG"
          ? "4H + 1H bullisch"
          : "4H + 1H bärisch",
  });

  if (trendDir === "NONE") {
    noTradeReasons.push(
      makeReason(
        "TREND_NOT_ALIGNED",
        "4H und 1H zeigen keine eindeutige gemeinsame Trendrichtung.",
      ),
    );
  }

  // ------------------------------------------------------------
  // LAYER 2 — STRUCTURE
  // ------------------------------------------------------------

  const struct = structure(ctx.candles1h, 40);

  const structOk =
    (trendDir === "LONG" && struct === "BULL") ||
    (trendDir === "SHORT" && struct === "BEAR");

  layers.push({
    name: "Struktur",
    status:
      trendDir === "NONE"
        ? "NEUTRAL"
        : structOk
          ? "PASS"
          : "FAIL",
    detail:
      struct === "BULL"
        ? "HH/HL"
        : struct === "BEAR"
          ? "LH/LL"
          : "Range / unklar",
  });

  if (trendDir !== "NONE" && !structOk) {
    noTradeReasons.push(
      makeReason(
        "STRUCTURE_NOT_CONFIRMED",
        "Die 1H-Marktstruktur bestätigt die Trendrichtung nicht.",
      ),
    );
  }

  // ------------------------------------------------------------
  // LAYER 3 — 15M ENTRY
  // ------------------------------------------------------------

  const lastClose = closes15[closes15.length - 1] ?? price;
  const lastCandle = ctx.candles15m[ctx.candles15m.length - 1];

  const bullCandle = lastCandle
    ? lastCandle.close > lastCandle.open
    : false;

  const pullbackLong =
    lastClose <= t15.ema20 * 1.005 &&
    lastClose >= t15.ema50 * 0.995;

  const pullbackShort =
    lastClose >= t15.ema20 * 0.995 &&
    lastClose <= t15.ema50 * 1.005;

  const rsiOkLong = rsi15 >= 50 && rsi15 <= 70;
  const rsiOkShort = rsi15 >= 30 && rsi15 <= 50;

  const volumeAverage = avgVolume(ctx.candles15m, 5);
  const lastVolume = lastCandle?.volume ?? 0;

  const volumeOk =
    volumeAverage > 0 && lastVolume > volumeAverage;

  let entryOk = false;

  if (trendDir === "LONG") {
    entryOk =
      pullbackLong &&
      bullCandle &&
      rsiOkLong;
  } else if (trendDir === "SHORT") {
    entryOk =
      pullbackShort &&
      !bullCandle &&
      rsiOkShort;
  }

  layers.push({
    name: "Entry",
    status:
      trendDir === "NONE"
        ? "NEUTRAL"
        : entryOk
          ? "PASS"
          : "FAIL",
    detail: entryOk
      ? "Pullback + Bestätigungskerze + RSI-Zone"
      : "Kein gültiger 15M-Entry",
  });

  if (trendDir !== "NONE" && !entryOk) {
    noTradeReasons.push(
      makeReason(
        "ENTRY_NOT_VALID",
        "Das 15M-Entry-Setup erfüllt die erforderlichen Bedingungen nicht.",
      ),
    );
  }

  if (!volumeOk) {
    noTradeReasons.push(
      makeReason(
        "VOLUME_NOT_CONFIRMED",
        "Das 15M-Volumen liegt nicht über dem Durchschnitt der letzten 5 Kerzen.",
      ),
    );
  }

  if (
    trendDir === "LONG" &&
    !rsiOkLong
  ) {
    noTradeReasons.push(
      makeReason(
        "RSI_NOT_CONFIRMED",
        "Der 15M-RSI liegt nicht in der Long-Bestätigungszone 50–70.",
      ),
    );
  }

  if (
    trendDir === "SHORT" &&
    !rsiOkShort
  ) {
    noTradeReasons.push(
      makeReason(
        "RSI_NOT_CONFIRMED",
        "Der 15M-RSI liegt nicht in der Short-Bestätigungszone 30–50.",
      ),
    );
  }

  // ------------------------------------------------------------
  // OI / FUNDING — SCORED ONLY
  // ------------------------------------------------------------

  const oiRising =
    ctx.oiHistory.length >= 2
      ? ctx.oiHistory[ctx.oiHistory.length - 1]!.value >
        ctx.oiHistory[0]!.value
      : false;

  const fundingNeutral =
    Math.abs(ctx.fundingRate) < 0.0005;

  const fundingSlightLong =
    ctx.fundingRate >= -0.0005 &&
    ctx.fundingRate <= 0.0008;

  const fundingSlightShort =
    ctx.fundingRate <= 0.0005 &&
    ctx.fundingRate >= -0.0008;

  // ------------------------------------------------------------
  // LAYER 4 — LIQUIDITY RISK
  // ------------------------------------------------------------

  const liquidity = liquidityRiskScore(ctx.candles15m);
  const liquidityRiskBlock = liquidity.score > 75;

  layers.push({
    name: "Liquidity Risk",
    status:
      liquidityRiskBlock
        ? "FAIL"
        : liquidity.score > 40
          ? "WARN"
          : "PASS",
    detail:
      liquidity.notes.length > 0
        ? liquidity.notes.join(" · ")
        : "Keine relevanten Auffälligkeiten",
  });

  if (liquidityRiskBlock) {
    noTradeReasons.push(
      makeReason(
        "LIQUIDITY_RISK",
        "Liquidity Risk Score " + liquidity.score + "/100 überschreitet den Blockierungswert von 75.",
      ),
    );
  }

  // ------------------------------------------------------------
  // LAYER 5 — RISK
  // ------------------------------------------------------------

  let stop = 0;
  const entry = price;
  let tp1 = 0;
  let tp2 = 0;
  let positionSize = 0;
  let riskAmount = 0;
  let crv = 0;

  let stopValid = false;
  let crvOk = false;

  if (trendDir !== "NONE" && atr15 > 0) {
    if (trendDir === "LONG") {
      stop = swingLow(
        ctx.candles15m.slice(-25),
        25,
      );

      stop = Math.min(
        stop,
        price - atr15,
      );
    } else {
      stop = swingHigh(
        ctx.candles15m.slice(-25),
        25,
      );

      stop = Math.max(
        stop,
        price + atr15,
      );
    }

    const stopDistance = Math.abs(price - stop);

    stopValid =
      stopDistance > atr15 * 0.4 &&
      stopDistance < atr15 * 4;

    riskAmount =
      (cfg.accountSize * cfg.riskPerTrade) / 100;

    positionSize =
      stopDistance > 0
        ? riskAmount / stopDistance
        : 0;

    if (trendDir === "LONG") {
      tp1 = price + stopDistance * 1.5;
      tp2 = price + stopDistance * 3;
    } else {
      tp1 = price - stopDistance * 1.5;
      tp2 = price - stopDistance * 3;
    }

    crv =
      stopDistance > 0
        ? Math.abs(tp1 - entry) / stopDistance
        : 0;

    crvOk =
      stopValid &&
      crv >= 1.5 - 1e-9;
  }

  layers.push({
    name: "Risk",
    status:
      trendDir === "NONE"
        ? "NEUTRAL"
        : stopValid
          ? "PASS"
          : "FAIL",
    detail:
      stopValid
        ? "SL " + stop.toFixed(2) + " · CRV " + crv.toFixed(2)
        : "Stop ungültig oder ATR nicht verfügbar",
  });

  if (trendDir !== "NONE" && !stopValid) {
    noTradeReasons.push(
      makeReason(
        "STOP_INVALID",
        "Der berechnete Stop-Loss liegt außerhalb des zulässigen ATR-Risikobereichs.",
      ),
    );
  }

  if (trendDir !== "NONE" && !crvOk) {
    noTradeReasons.push(
      makeReason(
        "CRV_INVALID",
        "Das berechnete CRV erfüllt die Mindestanforderung von 1,5 nicht.",
      ),
    );
  }

  // ------------------------------------------------------------
  // SCORE
  // ------------------------------------------------------------

  const scores = {
    trend: trendDir !== "NONE" ? 20 : 0,

    structure: structOk ? 15 : 0,

    entry: entryOk ? 10 : 0,

    volume: volumeOk ? 10 : 0,

    rsi:
      trendDir === "LONG" && rsiOkLong
        ? 5
        : trendDir === "SHORT" && rsiOkShort
          ? 5
          : 0,

    // OI deliberately remains scored-only.
    oi: oiRising ? 10 : 0,

    funding:
      trendDir === "LONG" &&
      (fundingNeutral || fundingSlightLong)
        ? 5
        : trendDir === "SHORT" &&
            (fundingNeutral || fundingSlightShort)
          ? 5
          : 0,

    // Lower liquidity risk = more available score.
    liquidityRisk: Math.max(
      0,
      10 - Math.round(liquidity.score / 10),
    ),

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
    scores.liquidityRisk +
    scores.risk +
    scores.crv;

  // ------------------------------------------------------------
  // HARD GATE
  // ------------------------------------------------------------

  const hardGatePassed =
    trendDir !== "NONE" &&
    structOk &&
    entryOk &&
    volumeOk &&
    (
      trendDir === "LONG"
        ? rsiOkLong
        : rsiOkShort
    ) &&
    !liquidityRiskBlock &&
    stopValid &&
    crvOk;

  // ------------------------------------------------------------
  // DECISION
  // ------------------------------------------------------------

  let decision: EngineResult["decision"] =
    "NO_TRADE";

  if (
    hardGatePassed &&
    totalScore >= 90
  ) {
    decision = "STRONG_SIGNAL";
  } else if (
    hardGatePassed &&
    totalScore >= cfg.minScore
  ) {
    decision = "SIGNAL";
  }

  if (
    decision === "NO_TRADE" &&
    noTradeReasons.length === 0
  ) {
    noTradeReasons.push(
      makeReason(
        "SCORE_TOO_LOW",
        "Hard Gate erfüllt nicht oder Score " + totalScore + " liegt unter dem Mindestwert " + cfg.minScore + ".",
      ),
    );
  }

  layers.push({
    name: "Decision",
    status:
      decision === "NO_TRADE"
        ? "FAIL"
        : "PASS",
    detail:
      decision === "NO_TRADE"
        ? "NO TRADE — keine Position"
        : "Signal Score " + totalScore,
  });

  // ------------------------------------------------------------
  // REASONING
  // ------------------------------------------------------------

  reasoning.push(
    trendDir === "NONE"
      ? "Trend nicht eindeutig — kein Trade."
      : "Trend " + trendDir + " — 4H und 1H ausgerichtet.",
  );

  reasoning.push(
    structOk
      ? "Struktur bestätigt (" + (struct === "BULL" ? "HH/HL" : "LH/LL") + ")."
      : "1H-Struktur nicht bestätigt.",
  );

  reasoning.push(
    entryOk
      ? "15M-Entry-Setup erfüllt."
      : "Kein gültiger 15M-Entry vorhanden.",
  );

  reasoning.push(
    "Liquidity Risk " + liquidity.score + "/100" + (liquidityRiskBlock ? " — BLOCKIERT" : "") + ".",
  );

  reasoning.push(
    stopValid
      ? "Risk-Layer ok — SL " + stop.toFixed(2) + "."
      : "Risk-Layer nicht erfüllt.",
  );

  reasoning.push(
    "Score " + totalScore + "/100.",
  );

  // ------------------------------------------------------------
  // RESULT
  // ------------------------------------------------------------

  const oiChangePct =
    ctx.oiHistory.length >= 2 &&
    ctx.oiHistory[0]!.value !== 0
      ? (
          (
            ctx.oiHistory[
              ctx.oiHistory.length - 1
            ]!.value -
            ctx.oiHistory[0]!.value
          ) /
          ctx.oiHistory[0]!.value
        ) * 100
      : 0;

  const result: EngineResult = {
    ts,

    price,

    direction: trendDir,

    decision,

    score: totalScore,

    scores,

    liquidityRiskScore:
      liquidity.score,

    dataHealth:
      createDataHealth(ts),

    noTradeReasons,

    layers,

    reasoning,

    market: {
      fundingRate:
        ctx.fundingRate,

      openInterest:
        ctx.openInterest,

      oiChangePct,

      longShortRatio:
        ctx.longShortRatio,

      rsi15m:
        rsi15,

      atr15m:
        atr15,

      ema20:
        t15.ema20,

      ema50:
        t15.ema50,

      ema200:
        t15.ema200,
    },
  };

  if (
    decision !== "NO_TRADE" &&
    trendDir !== "NONE"
  ) {
    result.trade = {
      direction: trendDir,

      entry,

      stop,

      tp1,

      tp2,

      risk: {
        accountSize:
          cfg.accountSize,

        riskPercent:
          cfg.riskPerTrade,

        riskAmount,

        leverage:
          cfg.leverage,

        entry,

        stop,

        tp1,

        tp2,

        positionSize,

        crv,
      },
    };
  }

  return result;
}
