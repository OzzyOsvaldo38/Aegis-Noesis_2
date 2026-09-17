// LIVE ENGINE ADAPTER
//
// Flow:
// MarketSnapshot
//   → Data Health
//   → remove still-forming candles
//   → shared strategy
//   → SIGNAL / NO_TRADE
//
// Safety principle:
// If market data is invalid, stale, incomplete or structurally broken,
// the engine MUST return NO_TRADE.
//
// No API calls are made here.
// No database access.
// No automatic trading.

import { last } from "./indicators";
import type { AppSettings } from "./storage";
import { decide, type StrategyContext } from "./strategy";
import type {
  Candle,
  DataHealth,
  DataHealthCheck,
  EngineResult,
  MarketSnapshot,
  User,
} from "./types";

const MAX_DATA_AGE_MS = 2 * 60 * 1000;

const REQUIRED_HISTORY = {
  "15m": 210,
  "1h": 210,
  "4h": 210,
} as const;

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function isCandleValid(candle: Candle): boolean {
  return (
    Number.isFinite(candle.openTime) &&
    Number.isFinite(candle.closeTime) &&
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close) &&
    Number.isFinite(candle.volume) &&
    candle.openTime < candle.closeTime &&
    candle.high >= Math.max(candle.open, candle.close) &&
    candle.low <= Math.min(candle.open, candle.close) &&
    candle.volume >= 0
  );
}

function hasAscendingTimestamps(candles: Candle[]): boolean {
  for (let i = 1; i < candles.length; i += 1) {
    if (candles[i]!.openTime <= candles[i - 1]!.openTime) {
      return false;
    }
  }

  return true;
}

function expectedIntervalMs(
  timeframe: "15m" | "1h" | "4h",
): number {
  if (timeframe === "15m") {
    return 15 * 60 * 1000;
  }

  if (timeframe === "1h") {
    return 60 * 60 * 1000;
  }

  return 4 * 60 * 60 * 1000;
}

function hasNoLargeGaps(
  candles: Candle[],
  timeframe: "15m" | "1h" | "4h",
): boolean {
  if (candles.length < 2) {
    return true;
  }

  const expected = expectedIntervalMs(timeframe);

  for (let i = 1; i < candles.length; i += 1) {
    const gap =
      candles[i]!.openTime -
      candles[i - 1]!.openTime;

    if (gap !== expected) {
      return false;
    }
  }

  return true;
}

function isCurrentlyForming(
  candle: Candle,
  now: number,
): boolean {
  return candle.closeTime > now;
}

function removeFormingCandle(
  candles: Candle[],
  now: number,
): Candle[] {
  if (candles.length === 0) {
    return [];
  }

  const lastCandle =
    candles[candles.length - 1]!;

  return isCurrentlyForming(lastCandle, now)
    ? candles.slice(0, -1)
    : candles;
}

function checkTimeframe(
  name: "15m" | "1h" | "4h",
  candles: Candle[],
  now: number,
): DataHealthCheck[] {
  const checks: DataHealthCheck[] = [];

  const closedCandles =
    removeFormingCandle(candles, now);

  if (
    closedCandles.length <
    REQUIRED_HISTORY[name]
  ) {
    checks.push({
      name: `${name} history`,
      status: "FAIL",
      detail:
        `Nur ${closedCandles.length} geschlossene Kerzen vorhanden; ` +
        `mindestens ${REQUIRED_HISTORY[name]} erforderlich.`,
    });
  } else {
    checks.push({
      name: `${name} history`,
      status: "PASS",
      detail:
        `${closedCandles.length} geschlossene Kerzen verfügbar.`,
    });
  }

  if (
    closedCandles.length > 0 &&
    !closedCandles.every(isCandleValid)
  ) {
    checks.push({
      name: `${name} OHLCV`,
      status: "FAIL",
      detail:
        "Mindestens eine Kerze enthält ungültige OHLCV-Daten.",
    });
  } else {
    checks.push({
      name: `${name} OHLCV`,
      status: "PASS",
      detail:
        "OHLCV-Werte sind strukturell gültig.",
    });
  }

  if (!hasAscendingTimestamps(closedCandles)) {
    checks.push({
      name: `${name} timestamps`,
      status: "FAIL",
      detail:
        "Kerzen sind nicht chronologisch sortiert.",
    });
  } else {
    checks.push({
      name: `${name} timestamps`,
      status: "PASS",
      detail:
        "Zeitstempel sind chronologisch sortiert.",
    });
  }

  if (
    !hasNoLargeGaps(
      closedCandles,
      name,
    )
  ) {
    checks.push({
      name: `${name} continuity`,
      status: "FAIL",
      detail:
        "Es wurde eine Datenlücke innerhalb der Kerzen erkannt.",
    });
  } else {
    checks.push({
      name: `${name} continuity`,
      status: "PASS",
      detail:
        "Keine Datenlücke erkannt.",
    });
  }

  return checks;
}

function buildDataHealth(
  market: MarketSnapshot,
  now: number,
): DataHealth {
  const checks: DataHealthCheck[] = [];

  checks.push(
    ...checkTimeframe(
      "15m",
      market.candles15m,
      now,
    ),
  );

  checks.push(
    ...checkTimeframe(
      "1h",
      market.candles1h,
      now,
    ),
  );

  checks.push(
    ...checkTimeframe(
      "4h",
      market.candles4h,
      now,
    ),
  );

  if (
    !isFiniteNumber(market.price) ||
    market.price <= 0
  ) {
    checks.push({
      name: "market price",
      status: "FAIL",
      detail:
        "Marktpreis ist ungültig.",
    });
  } else {
    checks.push({
      name: "market price",
      status: "PASS",
      detail:
        "Marktpreis ist gültig.",
    });
  }

  if (
    !Number.isFinite(market.fetchedAt) ||
    market.fetchedAt <= 0
  ) {
    checks.push({
      name: "data timestamp",
      status: "FAIL",
      detail:
        "Kein gültiger Datenzeitpunkt vorhanden.",
    });
  } else if (
    now - market.fetchedAt >
    MAX_DATA_AGE_MS
  ) {
    checks.push({
      name: "data freshness",
      status: "FAIL",
      detail:
        "Marktdaten sind älter als 2 Minuten.",
    });
  } else if (
    market.fetchedAt >
    now + 30_000
  ) {
    checks.push({
      name: "data timestamp",
      status: "FAIL",
      detail:
        "Datenzeitpunkt liegt unzulässig in der Zukunft.",
    });
  } else {
    checks.push({
      name: "data freshness",
      status: "PASS",
      detail:
        "Marktdaten sind aktuell.",
    });
  }

  const hasFailure = checks.some(
    (check) =>
      check.status === "FAIL",
  );

  return {
    status: hasFailure
      ? "INVALID"
      : "HEALTHY",
    checks,
    timestamp: now,
  };
}

function createBlockedResult(
  market: MarketSnapshot,
  health: DataHealth,
): EngineResult {
  const now = Date.now();

  return {
    ts: now,
    price: market.price,
    direction: "NONE",
    decision: "NO_TRADE",
    score: 0,

    scores: {
      trend: 0,
      structure: 0,
      entry: 0,
      volume: 0,
      rsi: 0,
      oi: 0,
      funding: 0,
      liquidityRisk: 0,
      risk: 0,
      crv: 0,
    },

    liquidityRiskScore: 0,

    dataHealth: health,

    noTradeReasons: [
      {
        code: "DATA_INVALID",
        message:
          "Marktdaten haben die Data-Health-Prüfung nicht bestanden. Kein Trade.",
        blocking: true,
      },
    ],

    layers: [
      {
        name: "Data Health",
        status: "FAIL",
        detail:
          "Datenqualität nicht ausreichend — Strategie wurde blockiert.",
      },
      {
        name: "Decision",
        status: "FAIL",
        detail:
          "NO TRADE — Data Health blockiert die Strategie.",
      },
    ],

    reasoning: [
      "Data Health fehlgeschlagen.",
      "Die Strategie wurde aus Sicherheitsgründen nicht ausgeführt.",
      "NO TRADE.",
    ],

    market: {
      fundingRate: market.fundingRate,
      openInterest: market.openInterest,
      oiChangePct: 0,
      longShortRatio:
        market.longShortRatio,
      rsi15m: 50,
      atr15m: 0,
      ema20: 0,
      ema50: 0,
      ema200: 0,
    },
  };
}

export function evaluate(
  market: MarketSnapshot,
  user: User,
  settings: AppSettings,
): EngineResult {
  const now = Date.now();

  const dataHealth =
    buildDataHealth(
      market,
      now,
    );

  if (
    dataHealth.status === "INVALID"
  ) {
    return createBlockedResult(
      market,
      dataHealth,
    );
  }

  const candles15m =
    removeFormingCandle(
      market.candles15m,
      now,
    );

  const candles1h =
    removeFormingCandle(
      market.candles1h,
      now,
    );

  const candles4h =
    removeFormingCandle(
      market.candles4h,
      now,
    );

  const closedPrice =
    last(candles15m)?.close ??
    market.price;

  const ctx: StrategyContext = {
    candles15m,
    candles1h,
    candles4h,
    price: closedPrice,
    fundingRate:
      market.fundingRate,
    openInterest:
      market.openInterest,
    oiHistory:
      market.oiHistory,
    longShortRatio:
      market.longShortRatio,
  };

  const result = decide(
    ctx,
    {
      minScore:
        settings.minScore,
      accountSize:
        user.account_size,
      riskPerTrade:
        user.risk_per_trade,
      leverage:
        user.default_leverage,
    },
  );

  result.dataHealth =
    dataHealth;

  // The UI may display the current MARK price,
  // while the strategy decision itself uses the
  // most recently CLOSED 15M candle.
  result.price =
    market.price;

  return result;
}