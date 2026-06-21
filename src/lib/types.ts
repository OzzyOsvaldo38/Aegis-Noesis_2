// Database-style schemas as TypeScript types (localStorage-backed).
// Field names mirror the spec; English code, German UI.

export type Direction = "LONG" | "SHORT";
export type Timeframe = "15m" | "1h" | "4h";
export type SignalStatus =
  | "OPEN"
  | "TP1_HIT"
  | "TP2_HIT"
  | "STOPPED"
  | "CANCELLED";

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
  manipulation_score: number;
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

export type LayerStatus = "PASS" | "FAIL" | "WARN" | "NEUTRAL";

export interface LayerResult {
  name: string;
  status: LayerStatus;
  detail: string;
}

export interface EngineResult {
  ts: number;
  price: number;
  direction: Direction | "NONE";
  decision: "NO_TRADE" | "SIGNAL" | "STRONG_SIGNAL";
  score: number;
  scores: {
    trend: number;
    structure: number;
    entry: number;
    volume: number;
    rsi: number;
    oi: number;
    funding: number;
    manipulation: number;
    risk: number;
    crv: number;
  };
  manipulationScore: number; // 0..100, >75 blocks
  layers: LayerResult[];
  reasoning: string[];
  trade?: {
    direction: Direction;
    entry: number;
    stop: number;
    tp1: number;
    tp2: number;
    riskAmount: number;
    positionSize: number;
    leverage: number;
    crv: number;
  };
  market: {
    fundingRate: number;
    openInterest: number;
    oiChangePct: number;
    longShortRatio: number;
    rsi15m: number;
    atr15m: number;
    ema20: number;
    ema50: number;
    ema200: number;
  };
}