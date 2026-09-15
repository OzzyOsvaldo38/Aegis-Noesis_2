// LIVE adapter + GATEKEEPER between market data and the shared strategy
// (./strategy.ts). Responsibilities, in order:
//   1. Reduce every timeframe to CLOSED candles only (no repainting).
//   2. Run a real data-health audit on those candles and the derived feeds.
//   3. Only call decide() when the data is good enough; otherwise NO_TRADE.
//
// It contains NO trading logic: all strategy conditions, score weights,
// stop/TP and CRV maths stay inside strategy.ts.

import { last } from "./indicators";
import type { AppSettings } from "./storage";
import { decide, type StrategyContext } from "./strategy";
import type {
  Candle,
  DataHealth,
  DataHealthCheck,
  DataHealthStatus,
  EngineResult,
  MarketSnapshot,
  NoTradeReason,
  User,
} from "./types";

/** Minimum history per timeframe (EMA200 is the most demanding indicator). */
const MIN_CANDLES = 210;
/** Nominal timeframe durations in ms, used for gap and close detection. */
const TF_MS = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
} as const;

type TfKey = keyof typeof TF_MS;

/** A candle counts as closed once its closeTime lies in the past. */
function isClosed(candle: Candle, now: number): boolean {
  return Number.isFinite(candle.closeTime) && candle.closeTime <= now;
}

/**
 * Keep only candles that are fully closed. Binance appends the still-forming
 * candle as the last element; a timestamp check is authoritative even if the
 * feed shape ever changes.
 */
function closedOnly(candles: Candle[], now: number): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    if (isClosed(c, now)) out.push(c);
  }
  return out;
}

function ohlcvValid(c: Candle): boolean {
  const nums = [c.open, c.high, c.low, c.close, c.volume, c.openTime, c.closeTime];
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return false;
  if (c.high < c.open || c.high < c.close) return false;
  if (c.low > c.open || c.low > c.close) return false;
  if (c.high < c.low) return false;
  if (c.volume < 0) return false;
  if (c.openTime <= 0 || c.closeTime <= c.openTime) return false;
  return true;
}

interface TfAudit {
  checks: DataHealthCheck[];
  hardFail: boolean;
}

/** Audit one timeframe's closed candles. */
function auditTimeframe(tf: TfKey, candles: Candle[], now: number): TfAudit {
  const checks: DataHealthCheck[] = [];
  let hardFail = false;
  const label = tf.toUpperCase();

  if (candles.length === 0) {
    checks.push({
      name: `${label} Candles`,
      status: "FAIL",
      detail: "Keine geschlossenen Candles vorhanden.",
    });
    return { checks, hardFail: true };
  }

  // History
  if (candles.length < MIN_CANDLES) {
    hardFail = true;
    checks.push({
      name: `${label} Historie`,
      status: "FAIL",
      detail: `${candles.length}/${MIN_CANDLES} Candles — zu wenig für EMA200.`,
    });
  } else {
    checks.push({
      name: `${label} Historie`,
      status: "PASS",
      detail: `${candles.length} geschlossene Candles.`,
    });
  }

  // OHLCV validity
  const invalid = candles.filter((c) => !ohlcvValid(c)).length;
  if (invalid > 0) {
    hardFail = true;
    checks.push({
      name: `${label} OHLCV`,
      status: "FAIL",
      detail: `${invalid} Candles mit unplausiblen Werten.`,
    });
  } else {
    checks.push({
      name: `${label} OHLCV`,
      status: "PASS",
      detail: "Alle Werte finite und plausibel.",
    });
  }

  // Ordering + duplicates
  let unordered = 0;
  let duplicates = 0;
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1]!;
    const cur = candles[i]!;
    if (cur.openTime === prev.openTime) duplicates++;
    else if (cur.openTime < prev.openTime) unordered++;
  }
  if (duplicates > 0 || unordered > 0) {
    hardFail = true;
    checks.push({
      name: `${label} Reihenfolge`,
      status: "FAIL",
      detail: `${duplicates} Duplikate, ${unordered} falsch sortiert.`,
    });
  } else {
    checks.push({
      name: `${label} Reihenfolge`,
      status: "PASS",
      detail: "Aufsteigend sortiert, keine Duplikate.",
    });
  }

  // Gaps
  const step = TF_MS[tf];
  let gaps = 0;
  for (let i = 1; i < candles.length; i++) {
    const delta = candles[i]!.openTime - candles[i - 1]!.openTime;
    if (delta > step * 1.5) gaps++;
  }
  if (gaps > 0) {
    checks.push({
      name: `${label} Lücken`,
      status: "WARN",
      detail: `${gaps} Zeitlücken erkannt.`,
    });
  } else {
    checks.push({
      name: `${label} Lücken`,
      status: "PASS",
      detail: "Keine Lücken.",
    });
  }

  // Last candle really closed + recency
  const lastCandle = candles[candles.length - 1]!;
  if (!isClosed(lastCandle, now)) {
    hardFail = true;
    checks.push({
      name: `${label} Abschluss`,
      status: "FAIL",
      detail: "Letzte Candle ist noch nicht geschlossen.",
    });
  } else if (now - lastCandle.closeTime > step * 3) {
    hardFail = true;
    checks.push({
      name: `${label} Aktualität`,
      status: "FAIL",
      detail: "Daten veraltet (>3 Intervalle alt).",
    });
  } else {
    checks.push({
      name: `${label} Aktualität`,
      status: "PASS",
      detail: "Letzte Candle geschlossen und aktuell.",
    });
  }

  return { checks, hardFail };
}

interface HealthAudit {
  health: DataHealth;
  fundingUsable: boolean;
  oiUsable: boolean;
}

function auditData(
  market: MarketSnapshot,
  c15: Candle[],
  c1h: Candle[],
  c4h: Candle[],
  now: number,
): HealthAudit {
  const checks: DataHealthCheck[] = [];
  let hardFail = false;

  for (const [tf, candles] of [
    ["15m", c15],
    ["1h", c1h],
    ["4h", c4h],
  ] as [TfKey, Candle[]][]) {
    const audit = auditTimeframe(tf, candles, now);
    checks.push(...audit.checks);
    if (audit.hardFail) hardFail = true;
  }

  // Funding — scored factor, missing data degrades but does not invalidate.
  const fundingUsable = Number.isFinite(market.fundingRate);
  checks.push({
    name: "Funding",
    status: fundingUsable ? "PASS" : "WARN",
    detail: fundingUsable
      ? "Funding-Rate vorhanden."
      : "Funding-Rate fehlt oder nicht numerisch.",
  });

  // Open interest — scored factor only, never substituted with fake values.
  const oiUsable =
    Number.isFinite(market.openInterest) &&
    Array.isArray(market.oiHistory) &&
    market.oiHistory.length >= 2 &&
    market.oiHistory.every((p) => Number.isFinite(p.value) && Number.isFinite(p.time));
  checks.push({
    name: "Open Interest",
    status: oiUsable ? "PASS" : "WARN",
    detail: oiUsable
      ? "OI-Historie vorhanden."
      : "OI-Daten fehlen oder unvollständig.",
  });

  // Live price is display-only, but a broken price signals a broken feed.
  const priceUsable = Number.isFinite(market.price) && market.price > 0;
  if (!priceUsable) hardFail = true;
  checks.push({
    name: "Preis",
    status: priceUsable ? "PASS" : "FAIL",
    detail: priceUsable ? "Marktpreis plausibel." : "Marktpreis ungültig.",
  });

  const hasWarn = checks.some((c) => c.status === "WARN");
  const status: DataHealthStatus = hardFail
    ? "INVALID"
    : hasWarn
      ? "DEGRADED"
      : "HEALTHY";

  return {
    health: { status, checks, checkedAt: now },
    fundingUsable,
    oiUsable,
  };
}

/** Complete NO_TRADE result used whenever the strategy must not run. */
function noTradeResult(
  market: MarketSnapshot | null,
  health: DataHealth,
  reasons: NoTradeReason[],
  price: number,
): EngineResult {
  const num = (v: number | undefined) =>
    typeof v === "number" && Number.isFinite(v) ? v : 0;
  const failing = health.checks
    .filter((c) => c.status !== "PASS")
    .map((c) => `${c.name}: ${c.detail}`);

  return {
    ts: health.checkedAt,
    price,
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
    layers: [
      {
        name: "Daten",
        status: health.status === "INVALID" ? "FAIL" : "WARN",
        detail:
          health.status === "INVALID"
            ? "Datenqualität unzureichend — Strategie nicht ausgeführt."
            : "Datenqualität eingeschränkt.",
      },
      {
        name: "Decision",
        status: "FAIL",
        detail: "Default — keine Position",
      },
    ],
    reasoning: [
      "Kein Trade: Marktdaten erfüllen die Qualitätsanforderungen nicht.",
      ...failing,
    ],
    noTradeReasons: reasons,
    market: {
      fundingRate: num(market?.fundingRate),
      openInterest: num(market?.openInterest),
      oiChangePct: 0,
      longShortRatio: num(market?.longShortRatio),
      rsi15m: 0,
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

  try {
    // ---- 1. CLOSED candles only ----
    const candles15m = closedOnly(market.candles15m ?? [], now);
    const candles1h = closedOnly(market.candles1h ?? [], now);
    const candles4h = closedOnly(market.candles4h ?? [], now);

    // ---- 2. Data-health gate ----
    const { health, fundingUsable, oiUsable } = auditData(
      market,
      candles15m,
      candles1h,
      candles4h,
      now,
    );

    const closedPrice = last(candles15m)?.close;
    const displayPrice = Number.isFinite(market.price)
      ? market.price
      : (closedPrice ?? 0);

    if (health.status === "INVALID" || !Number.isFinite(closedPrice ?? NaN)) {
      const reasons: NoTradeReason[] = [
        {
          code: "DATA_INVALID",
          message: "Marktdaten sind ungültig oder unvollständig — kein Trade.",
          blocking: true,
        },
      ];
      const shortHistory = [candles15m, candles1h, candles4h].some(
        (arr) => arr.length < MIN_CANDLES,
      );
      if (shortHistory) {
        reasons.push({
          code: "INSUFFICIENT_HISTORY",
          message: `Zu wenig geschlossene Candle-Historie (< ${MIN_CANDLES} pro Timeframe).`,
          blocking: true,
        });
      }
      return noTradeResult(market, health, reasons, displayPrice);
    }

    // ---- 3. Strategy (unchanged) on closed candles ----
    const ctx: StrategyContext = {
      candles15m,
      candles1h,
      candles4h,
      price: closedPrice!,
      fundingRate: fundingUsable ? market.fundingRate : 0,
      openInterest: oiUsable ? market.openInterest : 0,
      oiHistory: oiUsable ? market.oiHistory : [],
      longShortRatio: Number.isFinite(market.longShortRatio)
        ? market.longShortRatio
        : 0,
    };

    const result = decide(ctx, {
      minScore: settings.minScore,
      accountSize: user.account_size,
      riskPerTrade: user.risk_per_trade,
      leverage: user.default_leverage,
    });

    // Real audit replaces the strategy's placeholder.
    result.dataHealth = health;

    if (health.status === "DEGRADED") {
      result.reasoning.push(
        "Hinweis: Datenqualität eingeschränkt (DEGRADED) — Entscheidung konservativ bewerten.",
      );
      result.noTradeReasons = [
        ...result.noTradeReasons,
        {
          code: "DATA_DEGRADED",
          message: "Nicht-kritische Marktdaten fehlen oder sind eingeschränkt.",
          blocking: false,
        },
      ];
    }

    // Display the live mark price; decisions used the closed close.
    result.price = displayPrice;
    return result;
  } catch (err) {
    const health: DataHealth = {
      status: "INVALID",
      checks: [
        {
          name: "Verarbeitung",
          status: "FAIL",
          detail:
            err instanceof Error
              ? `Auswertung fehlgeschlagen: ${err.message}`
              : "Auswertung fehlgeschlagen.",
        },
      ],
      checkedAt: now,
    };
    return noTradeResult(
      market ?? null,
      health,
      [
        {
          code: "DATA_INVALID",
          message: "Marktdaten konnten nicht verarbeitet werden — kein Trade.",
          blocking: true,
        },
      ],
      Number.isFinite(market?.price) ? market.price : 0,
    );
  }
}
