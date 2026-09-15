// Aegis Noesis — V2 data model.
// Pure type definitions only: no logic, no functions, no calculations.
// English code, German UI.

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

export type Direction = "LONG" | "SHORT";

export type Timeframe = "15m" | "1h" | "4h";

/** Lifecycle of a generated signal. */
export type SignalStatus =
  | "OPEN"
  | "TP1_HIT"
  | "TP2_HIT"
  | "STOPPED"
  | "CANCELLED"
  | "EXPIRED"
  | "INVALIDATED";

// ---------------------------------------------------------------------------
// Data health
// ---------------------------------------------------------------------------

export type DataHealthStatus = "HEALTHY" | "DEGRADED" | "INVALID";

/**
 * One single data-quality check. Intended checks (logic implemented later):
 * sufficient candle history, correct timestamps, no duplicates, no candle
 * gaps, valid OHLCV values, data recency, funding data present,
 * open-interest data present.
 */
export interface DataHealthCheck {
  name: string;
  status: "PASS" | "WARN" | "FAIL";
  detail: string;
}

export interface DataHealth {
  status: DataHealthStatus;
  checks: DataHealthCheck[];
  checkedAt: number;
}

// ---------------------------------------------------------------------------
// No-trade reasons
// ---------------------------------------------------------------------------

export type NoTradeReasonCode =
  | "DATA_INVALID"
  | "DATA_DEGRADED"
  | "TREND_NOT_ALIGNED"
  | "STRUCTURE_NOT_CONFIRMED"
  | "ENTRY_NOT_CONFIRMED"
  | "VOLUME_NOT_CONFIRMED"
  | "RSI_NOT_CONFIRMED"
  | "LIQUIDITY_RISK_TOO_HIGH"
  | "STOP_INVALID"
  | "CRV_TOO_LOW"
  | "RISK_LIMIT_REACHED"
  | "INSUFFICIENT_HISTORY";

export interface NoTradeReason {
  code: NoTradeReasonCode;
  message: string;
  /** true = hard blocker, false = informational downgrade. */
  blocking: boolean;
}

// ---------------------------------------------------------------------------
// Risk & trade planning
// ---------------------------------------------------------------------------

export interface RiskPlan {
  accountSize: number; // USDT
  riskPercent: number; // %
  riskAmount: number; // USDT
  leverage: number;
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  positionSize: number; // base asset units
  crv: number; // reward / risk
}

export interface TradePlan {
  direction: Direction;
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  risk: RiskPlan;
}

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  email: string;
  created_at: number;
  plan: "free" | "pro";
  account_size: number; // USDT
  risk_per_trade: number; // %
  daily_risk_limit: number; // %
  weekly_risk_limit: number; // %
  default_leverage: number; // 5..20
}

// ---------------------------------------------------------------------------
// Market data
// ---------------------------------------------------------------------------

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export interface MarketSnapshot {
  price: number;
  candles4h: Candle[];
  candles1h: Candle[];
  candles15m: Candle[];
  fundingRate: number;
  nextFundingTime: number;
  openInterest: number;
  oiHistory: { time: number; value: number }[];
  longShortRatio: number; // longAccount / shortAccount
  fetchedAt: number;
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

export type LayerStatus = "PASS" | "FAIL" | "WARN" | "NEUTRAL";

export interface LayerResult {
  name: string;
  status: LayerStatus;
  detail: string;
}

// ---------------------------------------------------------------------------
// Engine result
// ---------------------------------------------------------------------------

export type Decision = "NO_TRADE" | "SIGNAL" | "STRONG_SIGNAL";

export interface EngineScores {
  trend: number;
  structure: number;
  entry: number;
  volume: number;
  rsi: number;
  oi: number;
  funding: number;
  liquidityRisk: number;
  risk: number;
  crv: number;
}

export interface EngineMarketContext {
  fundingRate: number;
  openInterest: number;
  oiChangePct: number;
  longShortRatio: number;
  rsi15m: number;
  atr15m: number;
  ema20: number;
  ema50: number;
  ema200: number;
}

export interface EngineResult {
  ts: number;
  price: number;
  /** "NONE" = no directional bias, therefore no trade. */
  direction: Direction | "NONE";
  decision: Decision;
  score: number; // 0..100
  scores: EngineScores;
  /**
   * 0..100 liquidity/volatility risk. Describes detected liquidity and
   * volatility risk only — it does NOT claim to prove market manipulation.
   */
  liquidityRiskScore: number;
  dataHealth: DataHealth;
  layers: LayerResult[];
  reasoning: string[];
  noTradeReasons: NoTradeReason[];
  trade?: TradePlan;
  market: EngineMarketContext;
}

// ---------------------------------------------------------------------------
// Persisted records
// ---------------------------------------------------------------------------

export interface Signal {
  id: string;
  timestamp: number;
  symbol: string;
  direction: Direction;
  entry_price: number;
  stop_loss: number;
  tp1: number;
  tp2: number;
  signal_score: number;
  liquidity_risk_score: number;
  trend_status: string;
  structure_status: string;
  funding_rate: number;
  open_interest: number;
  risk_amount: number;
  position_size: number;
  leverage: number;
  status: SignalStatus;
}

export interface JournalEntry {
  id: string;
  signal_id: string;
  entry: number;
  exit: number;
  profit_loss: number; // USDT
  r_multiple: number;
  duration: number; // ms
  notes: string;
  created_at: number;
}

export interface AnalyticsRow {
  id: string;
  date: string; // YYYY-MM-DD
  winrate: number;
  profit_factor: number;
  expectancy: number;
  avg_win: number;
  avg_loss: number;
  drawdown: number;
}
