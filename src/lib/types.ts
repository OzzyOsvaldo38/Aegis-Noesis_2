// Database-style schemas as TypeScript types (localStorage-backed).
// Field names mirror the spec; English code, German UI.

export type Direction = "LONG" | "SHORT";

export type Timeframe = "15m" | "1h" | "4h";

export type SignalStatus =
  | "OPEN"
  | "TP1_HIT"
  | "TP2_HIT"
  | "STOPPED"
  | "CANCELLED"
  | "EXPIRED"
  | "INVALIDATED";

export type DataHealthStatus = "HEALTHY" | "DEGRADED" | "INVALID";

export interface DataHealthCheck {
  name: string;
  status: "PASS" | "WARN" | "FAIL";
  detail: string;
}

export interface DataHealth {
  status: DataHealthStatus;
  checks: DataHealthCheck[];
  timestamp: number;
}

export type NoTradeReasonCode =
  | "DATA_INVALID"
  | "INSUFFICIENT_HISTORY"
  | "TREND_NOT_ALIGNED"
  | "STRUCTURE_NOT_CONFIRMED"
  | "ENTRY_NOT_VALID"
  | "VOLUME_NOT_CONFIRMED"
  | "RSI_NOT_CONFIRMED"
  | "LIQUIDITY_RISK"
  | "STOP_INVALID"
  | "CRV_INVALID"
  | "SCORE_TOO_LOW";

export interface NoTradeReason {
  code: NoTradeReasonCode;
  message: string;
  blocking: boolean;
}

export interface User {
  id: string;
  email: string;
  created_at: number;
  plan: "free" | "pro";
  account_size: number;
  risk_per_trade: number;
  daily_risk_limit: number;
  weekly_risk_limit: number;
  default_leverage: number;
}

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
  profit_loss: number;
  r_multiple: number;
  duration: number;
  notes: string;
  created_at: number;
}

export interface AnalyticsRow {
  id: string;
  date: string;
  winrate: number;
  profit_factor: number;
  expectancy: number;
  avg_win: number;
  avg_loss: number;
  drawdown: number;
}

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
  longShortRatio: number;
  fetchedAt: number;
}

export type LayerStatus = "PASS" | "FAIL" | "WARN" | "NEUTRAL";

export interface LayerResult {
  name: string;
  status: LayerStatus;
  detail: string;
}

export interface RiskPlan {
  accountSize: number;
  riskPercent: number;
  riskAmount: number;
  leverage: number;
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  positionSize: number;
  crv: number;
}

export interface TradePlan {
  direction: Direction;
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  risk: RiskPlan;
}

export interface Decision {
  direction: Direction | "NONE";
  decision: "NO_TRADE" | "SIGNAL" | "STRONG_SIGNAL";
  score: number;
}

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
  direction: Direction | "NONE";
  decision: Decision["decision"];
  score: number;
  scores: EngineScores;
  liquidityRiskScore: number;
  dataHealth: DataHealth;
  noTradeReasons: NoTradeReason[];
  layers: LayerResult[];
  reasoning: string[];
  trade?: TradePlan;
  market: EngineMarketContext;
}