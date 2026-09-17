import { last } from "./indicators";
import { decide, type StrategyContext } from "./strategy";
import type { Candle } from "./types";

export interface BacktestParams {
  candles: Candle[];
  accountSize: number;
  riskPct: number;
  feeBps: number;
  slippageBps: number;
  fundingRateAvg: number;
  rrTp1: number;
  rrTp2: number;
  minScore?: number;

  volumeMultiplier?: number;
  rsiLongMin?: number;
  rsiLongMax?: number;
  rsiShortMin?: number;
  rsiShortMax?: number;
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
  calmar?: number;
  maxConsecLosses?: number;
  tradesPerWeek?: number;
}

const HOUR = 3_600_000;
const FOUR_HOURS = 14_400_000;

function resample(candles: Candle[], factorMs: number): Candle[] {
  const map = new Map<number, Candle>();
  const order: number[] = [];

  for (const candle of candles) {
    const key =
      Math.floor(candle.openTime / factorMs) * factorMs;

    const existing = map.get(key);

    if (!existing) {
      map.set(key, {
        openTime: key,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        closeTime: key + factorMs - 1,
      });

      order.push(key);
    } else {
      existing.high = Math.max(existing.high, candle.high);
      existing.low = Math.min(existing.low, candle.low);
      existing.close = candle.close;
      existing.volume += candle.volume;
    }
  }

  return order.map((key) => map.get(key)!);
}

interface OpenPosition {
  direction: "LONG" | "SHORT";
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  sizeCoins: number;
  remaining: number;
  tookTP1: boolean;
  openTime: number;
  openIdx: number;
  realizedPnl: number;
  lastExit: number;
}

export function runBacktest(
  params: BacktestParams,
): BacktestResult {
  const candles = params.candles;

  const candles1h = resample(candles, HOUR);
  const candles4h = resample(candles, FOUR_HOURS);

  const minScore = params.minScore ?? 80;

  const fee = params.feeBps / 10_000;
  const slippage = params.slippageBps / 10_000;

  const riskAmount =
    (params.accountSize * params.riskPct) / 100;

  const W15 = 600;
  const WHTF = 400;
  const START = 260;

  let index1h = -1;
  let index4h = -1;

  const trades: BacktestTrade[] = [];

  let equity = params.accountSize;

  const equityCurve: {
    time: number;
    value: number;
  }[] = [];

  let open: OpenPosition | null = null;

  const auditReasons: Record<string, number> = {};
  let auditDecisions = 0;
  let auditSignals = 0;

  const directionSign = (
    direction: "LONG" | "SHORT",
  ): number => {
    return direction === "LONG" ? 1 : -1;
  };

  function finalizeTrade(
    position: OpenPosition,
    outcome: "TP1" | "TP2" | "STOP",
    closeTime: number,
  ): void {
    trades.push({
      openTime: position.openTime,
      closeTime,
      direction: position.direction,
      entry: position.entry,
      stop: position.stop,
      tp1: position.tp1,
      tp2: position.tp2,
      exit: position.lastExit,
      outcome,
      pnl: position.realizedPnl,
      rMultiple:
        riskAmount > 0
          ? position.realizedPnl / riskAmount
          : 0,
    });
  }

  function settle(
    position: OpenPosition,
    fraction: number,
    exitPrice: number,
    closeTime: number,
  ): void {
    const coins =
      position.sizeCoins * fraction;

    const sign = directionSign(
      position.direction,
    );

    let pnl =
      (exitPrice - position.entry) *
      sign *
      coins;

    const entryNotional =
      position.entry * coins;

    const exitNotional =
      exitPrice * coins;

    pnl -=
      (entryNotional + exitNotional) *
      (fee + slippage);

    const hours =
      (closeTime - position.openTime) /
      HOUR;

    const funding =
      entryNotional *
      params.fundingRateAvg *
      (hours / 8);

    if (position.direction === "LONG") {
      pnl -= funding;
    } else {
      pnl += funding;
    }

    equity += pnl;
    position.realizedPnl += pnl;
    position.lastExit = exitPrice;
  }

  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i]!;

    while (
      index1h + 1 < candles1h.length &&
      candles1h[index1h + 1]!.closeTime <=
        bar.closeTime
    ) {
      index1h++;
    }

    while (
      index4h + 1 < candles4h.length &&
      candles4h[index4h + 1]!.closeTime <=
        bar.closeTime
    ) {
      index4h++;
    }

    if (open && i > open.openIdx) {
      const direction = open.direction;

      const hitStop =
        direction === "LONG"
          ? bar.low <= open.stop
          : bar.high >= open.stop;

      const hitTP1 =
        !open.tookTP1 &&
        (direction === "LONG"
          ? bar.high >= open.tp1
          : bar.low <= open.tp1);

      const hitTP2 =
        direction === "LONG"
          ? bar.high >= open.tp2
          : bar.low <= open.tp2;

      let closed = false;

      /*
       * Conservative candle assumption:
       * if stop and target are both touched
       * during the same candle, stop is assumed
       * to have happened first.
       */
      if (hitStop) {
        settle(
          open,
          open.remaining,
          open.stop,
          bar.closeTime,
        );

        open.remaining = 0;
        closed = true;

        finalizeTrade(
          open,
          open.tookTP1 ? "TP1" : "STOP",
          bar.closeTime,
        );
      } else {
        if (hitTP1) {
          settle(
            open,
            0.5,
            open.tp1,
            bar.closeTime,
          );

          open.remaining = 0.5;
          open.tookTP1 = true;
          open.stop = open.entry;
        }

        if (hitTP2) {
          settle(
            open,
            open.remaining,
            open.tp2,
            bar.closeTime,
          );

          open.remaining = 0;
          closed = true;

          finalizeTrade(
            open,
            "TP2",
            bar.closeTime,
          );
        }
      }

      if (closed) {
        open = null;
      }
    }

    if (!open && i >= START) {
      const window15m = candles.slice(
        Math.max(0, i - W15 + 1),
        i + 1,
      );

      const window1h = candles1h.slice(
        Math.max(
          0,
          index1h - WHTF + 1,
        ),
        index1h + 1,
      );

      const window4h = candles4h.slice(
        Math.max(
          0,
          index4h - WHTF + 1,
        ),
        index4h + 1,
      );

      if (
        window15m.length >= 210 &&
        window1h.length >= 60 &&
        window4h.length >= 60
      ) {
        const context: StrategyContext = {
          candles15m: window15m,
          candles1h: window1h,
          candles4h: window4h,
          price: bar.close,
          fundingRate:
            params.fundingRateAvg,
          openInterest: 0,
          oiHistory: [],
          longShortRatio: 1,
        };

        const result = decide(context, {
          minScore,
          accountSize: params.accountSize,
          riskPerTrade: params.riskPct,
          leverage: 1,

          volumeMultiplier:
            params.volumeMultiplier,

          rsiLongMin:
            params.rsiLongMin,

          rsiLongMax:
            params.rsiLongMax,

          rsiShortMin:
            params.rsiShortMin,

          rsiShortMax:
            params.rsiShortMax,
        });

        auditDecisions++;

        if (
          result.decision ===
          "NO_TRADE"
        ) {
          for (const reason of
            result.noTradeReasons ?? []) {
            auditReasons[reason.code] =
              (auditReasons[reason.code] ?? 0) +
              1;
          }
        } else if (result.trade) {
          auditSignals++;
        }

        if (
          result.decision !==
            "NO_TRADE" &&
          result.trade
        ) {
          const trade = result.trade;

          open = {
            direction: trade.direction,
            entry: trade.entry,
            stop: trade.stop,
            tp1: trade.tp1,
            tp2: trade.tp2,
            sizeCoins:
              trade.risk.positionSize,
            remaining: 1,
            tookTP1: false,
            openTime: bar.openTime,
            openIdx: i,
            realizedPnl: 0,
            lastExit: trade.entry,
          };
        }
      }
    }

    equityCurve.push({
      time: bar.closeTime,
      value: equity,
    });
  }

  const wins = trades.filter(
    (trade) => trade.pnl > 0,
  );

  const losses = trades.filter(
    (trade) => trade.pnl <= 0,
  );

  const winrate =
    trades.length > 0
      ? (wins.length / trades.length) * 100
      : 0;

  const grossWin = wins.reduce(
    (sum, trade) => sum + trade.pnl,
    0,
  );

  const grossLoss = Math.abs(
    losses.reduce(
      (sum, trade) => sum + trade.pnl,
      0,
    ),
  );

  const profitFactor =
    grossLoss > 0
      ? grossWin / grossLoss
      : grossWin > 0
        ? 99
        : 0;

  const avgWin =
    wins.length > 0
      ? grossWin / wins.length
      : 0;

  const avgLoss =
    losses.length > 0
      ? -grossLoss / losses.length
      : 0;

  const expectancy =
    trades.length > 0
      ? trades.reduce(
          (sum, trade) =>
            sum + trade.pnl,
          0,
        ) / trades.length
      : 0;

  let peak = params.accountSize;
  let maxDD = 0;

  for (const point of equityCurve) {
    if (point.value > peak) {
      peak = point.value;
    }

    const dd =
      peak > 0
        ? ((peak - point.value) /
            peak) *
          100
        : 0;

    if (dd > maxDD) {
      maxDD = dd;
    }
  }

  const finalEquity =
    last(equityCurve)?.value ??
    params.accountSize;

  const drawdown =
    peak > 0
      ? ((peak - finalEquity) /
          peak) *
        100
      : 0;

  const dailyReturns =
    toDailyReturns(equityCurve);

  const dailyMean = mean(dailyReturns);

  const dailyStd = std(
    dailyReturns,
    dailyMean,
  );

  const downsideStd = std(
    dailyReturns.filter(
      (value) => value < 0,
    ),
    0,
  );

  const sharpe =
    dailyStd > 0
      ? (dailyMean / dailyStd) *
        Math.sqrt(365)
      : 0;

  const sortino =
    downsideStd > 0
      ? (dailyMean / downsideStd) *
        Math.sqrt(365)
      : 0;

  const spanMs =
    equityCurve.length > 1
      ? equityCurve[
          equityCurve.length - 1
        ]!.time -
        equityCurve[0]!.time
      : 0;

  const years =
    spanMs /
    (365 * 24 * HOUR);

  const cagr =
    years > 0 &&
    params.accountSize > 0 &&
    finalEquity > 0
      ? (Math.pow(
          finalEquity /
            params.accountSize,
          1 / years,
        ) -
          1) *
        100
      : 0;

  const calmar =
    maxDD > 0
      ? cagr / maxDD
      : 0;

  const tradesPerWeek =
    spanMs > 0
      ? trades.length /
        (spanMs /
          (7 * 24 * HOUR))
      : 0;

  let maxConsecLosses = 0;
  let consecutiveLosses = 0;

  for (const trade of trades) {
    if (trade.pnl <= 0) {
      consecutiveLosses++;

      if (
        consecutiveLosses >
        maxConsecLosses
      ) {
        maxConsecLosses =
          consecutiveLosses;
      }
    } else {
      consecutiveLosses = 0;
    }
  }

  console.log("");
  console.log(
    "=== STRATEGY AUDIT ===",
  );

  console.log(
    "Volume multiplier:",
    params.volumeMultiplier ?? 1.0,
  );

  console.log(
    "Decisions evaluated:",
    auditDecisions,
  );

  console.log(
    "Signals:",
    auditSignals,
  );

  console.log(
    "NO-TRADE REASONS:",
  );

  for (const [
    reason,
    count,
  ] of Object.entries(
    auditReasons,
  ).sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(
      `${reason}: ${count}`,
    );
  }

  const totalNoTrades =
    auditDecisions -
    auditSignals;

  console.log("");
  console.log(
    "=== CONTROLLED RELAXATION DIAGNOSTIC ===",
  );

  console.log(
    "Baseline/variant signals:",
    auditSignals,
  );

  console.log(
    "NO_TRADE:",
    totalNoTrades,
  );

  const diagnosticReasons = [
    "VOLUME_NOT_CONFIRMED",
    "RSI_NOT_CONFIRMED",
    "ENTRY_NOT_VALID",
  ];

  console.log("");
  console.log(
    "Potential quality-filter bottlenecks:",
  );

  for (const reason of
    diagnosticReasons) {
    const rejected =
      auditReasons[reason] ?? 0;

    const share =
      auditDecisions > 0
        ? (
            (rejected /
              auditDecisions) *
            100
          ).toFixed(1)
        : "0.0";

    console.log(
      `${reason}: ${rejected} rejections (${share}% of evaluated decisions)`,
    );
  }

  return {
    trades,
    equity: equityCurve,
    finalEquity,
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

function toDailyReturns(
  curve: {
    time: number;
    value: number;
  }[],
): number[] {
  if (curve.length < 2) {
    return [];
  }

  const byDay =
    new Map<number, number>();

  for (const point of curve) {
    const day = Math.floor(
      point.time /
        (24 * HOUR),
    );

    byDay.set(
      day,
      point.value,
    );
  }

  const days = [
    ...byDay.keys(),
  ].sort(
    (a, b) => a - b,
  );

  const values = days.map(
    (day) => byDay.get(day)!,
  );

  const returns: number[] = [];

  for (
    let i = 1;
    i < values.length;
    i++
  ) {
    const previous =
      values[i - 1]!;

    if (previous > 0) {
      returns.push(
        (values[i]! -
          previous) /
          previous,
      );
    }
  }

  return returns;
}

function mean(
  values: number[],
): number {
  if (!values.length) {
    return 0;
  }

  return (
    values.reduce(
      (sum, value) =>
        sum + value,
      0,
    ) / values.length
  );
}

function std(
  values: number[],
  providedMean: number,
): number {
  if (!values.length) {
    return 0;
  }

  const average =
    providedMean ||
    mean(values);

  return Math.sqrt(
    values.reduce(
      (sum, value) =>
        sum +
        (value - average) ** 2,
      0,
    ) / values.length,
  );
}

export async function fetchHistory(
  symbol: string,
  days: number,
): Promise<Candle[]> {
  const target = Math.ceil(
    (days * 24 * 60) / 15,
  );

  const candles: Candle[] = [];

  let endTime = Date.now();

  while (
    candles.length < target
  ) {
    const url =
      "https://fapi.binance.com/fapi/v1/klines" +
      `?symbol=${encodeURIComponent(symbol)}` +
      "&interval=15m" +
      "&limit=1500" +
      `&endTime=${endTime}`;

    const response =
      await fetch(url);

    if (!response.ok) {
      break;
    }

    const raw =
      (await response.json()) as (
        | string
        | number
      )[][];

    if (!raw.length) {
      break;
    }

    const batch: Candle[] =
      raw.map((k) => ({
        openTime: Number(k[0]),
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        volume: Number(k[5]),
        closeTime: Number(k[6]),
      }));

    candles.unshift(...batch);

    endTime =
      batch[0]!.openTime - 1;

    if (batch.length < 1500) {
      break;
    }
  }

  return candles.slice(-target);
}