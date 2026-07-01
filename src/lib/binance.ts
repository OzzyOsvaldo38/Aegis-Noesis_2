// Binance USDT-M Futures public REST client. No API key required.
// Docs: https://binance-docs.github.io/apidocs/futures/en/

import type { Candle, MarketSnapshot } from "./types";

const BASE = "https://fapi.binance.com";
const DATA = "https://fapi.binance.com"; // /futures/data lives here too

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Binance ${path} ${res.status}`);
  return (await res.json()) as T;
}

function parseKlines(raw: unknown[]): Candle[] {
  return (raw as (string | number)[][]).map((k) => ({
    openTime: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    closeTime: Number(k[6]),
  }));
}

export async function fetchKlines(
  symbol: string,
  interval: "15m" | "1h" | "4h",
  limit = 500,
): Promise<Candle[]> {
  const data = await getJSON<unknown[]>(
    `/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
  );
  return parseKlines(data);
}

export async function fetchPremiumIndex(symbol: string) {
  const data = await getJSON<{
    markPrice: string;
    lastFundingRate: string;
    nextFundingTime: number;
  }>(`/fapi/v1/premiumIndex?symbol=${symbol}`);
  return {
    markPrice: Number(data.markPrice),
    fundingRate: Number(data.lastFundingRate),
    nextFundingTime: Number(data.nextFundingTime),
  };
}

export async function fetchOpenInterestHist(symbol: string) {
  const data = await getJSON<{ sumOpenInterest: string; timestamp: number }[]>(
    `${DATA.replace(BASE, "")}/futures/data/openInterestHist?symbol=${symbol}&period=15m&limit=30`,
  );
  return data.map((d) => ({
    time: Number(d.timestamp),
    value: Number(d.sumOpenInterest),
  }));
}

export async function fetchLongShortRatio(symbol: string) {
  const data = await getJSON<{ longShortRatio: string }[]>(
    `/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=15m&limit=1`,
  );
  if (!data.length) return 1;
  return Number(data[0]!.longShortRatio);
}

export async function fetchSnapshot(symbol: string): Promise<MarketSnapshot> {
  const [c4, c1, c15, prem, oi, ls] = await Promise.all([
    fetchKlines(symbol, "4h", 500),
    fetchKlines(symbol, "1h", 500),
    fetchKlines(symbol, "15m", 500),
    fetchPremiumIndex(symbol),
    fetchOpenInterestHist(symbol).catch(() => []),
    fetchLongShortRatio(symbol).catch(() => 1),
  ]);

  return {
    price: prem.markPrice,
    candles4h: c4,
    candles1h: c1,
    candles15m: c15,
    fundingRate: prem.fundingRate,
    nextFundingTime: prem.nextFundingTime,
    openInterest: oi.length ? oi[oi.length - 1]!.value : 0,
    oiHistory: oi,
    longShortRatio: ls,
    fetchedAt: Date.now(),
  };
}