// Thin LIVE adapter around the shared strategy (./strategy.ts).
// Its only job: turn a live MarketSnapshot into a CLOSED-candle StrategyContext
// and call decide(). Keeping the same exported signature means the UI and
// use-engine hook need no changes.

import { last } from "./indicators";
import type { AppSettings } from "./storage";
import { decide, type StrategyContext } from "./strategy";
import type { EngineResult, MarketSnapshot, User } from "./types";

/** Binance returns the still-forming candle as the last element. Drop it so the
 *  strategy only ever sees CLOSED candles (no repainting). */
function dropForming<T>(arr: T[]): T[] {
  return arr.length > 1 ? arr.slice(0, -1) : arr;
}

export function evaluate(
  market: MarketSnapshot,
  user: User,
  settings: AppSettings,
): EngineResult {
  const candles15m = dropForming(market.candles15m);
  const candles1h = dropForming(market.candles1h);
  const candles4h = dropForming(market.candles4h);

  const closedPrice = last(candles15m)?.close ?? market.price;

  const ctx: StrategyContext = {
    candles15m,
    candles1h,
    candles4h,
    price: closedPrice,
    fundingRate: market.fundingRate,
    openInterest: market.openInterest,
    oiHistory: market.oiHistory,
    longShortRatio: market.longShortRatio,
  };

  const result = decide(ctx, {
    minScore: settings.minScore,
    accountSize: user.account_size,
    riskPerTrade: user.risk_per_trade,
    leverage: user.default_leverage,
  });

  // Show the live MARK price in the UI; decisions still use the closed close.
  result.price = market.price;
  return result;
}
