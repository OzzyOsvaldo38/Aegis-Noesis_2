// Binance USDT-M Futures public REST client.
// No API key required.
// No trading or order endpoints are used.

import type { Candle, MarketSnapshot } from "./types";

const BASE_URL = "https://fapi.binance.com";
const FETCH_TIMEOUT_MS = 10_000;

type BinanceKline = (string | number)[];

type PremiumIndexResponse = {
  markPrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
};

type OpenInterestHistoryItem = {
  sumOpenInterest: string;
  timestamp: number;
};

type LongShortRatioItem = {
  longShortRatio: string;
};

async function getJSON<T>(path: string, signal?: AbortSignal): Promise<T> {
  return fetchWithTimeout(
    `${BASE_URL}${path}`,
    {
      cache: "no-store",
      signal,
    },
    FETCH_TIMEOUT_MS,
    async (response) => {
      if (!response.ok) {
        throw new Error(`Binance API error ${response.status} on ${path}`);
      }

      return (await response.json()) as T;
    },
  );
}

export async function fetchWithTimeout<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs: number,
  processResponse: (response: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const externalSignal = init.signal;

  if (externalSignal?.aborted) {
    throw externalSignal.reason ?? new DOMException("The request was aborted.", "AbortError");
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromCaller);
    };

    const rejectOnce = (error: unknown) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    };

    const abortFromCaller = () => {
      controller.abort(externalSignal?.reason);
      rejectOnce(
        externalSignal?.reason ?? new DOMException("The request was aborted.", "AbortError"),
      );
    };

    const timeout = setTimeout(() => {
      controller.abort();
      rejectOnce(new Error(`Binance request timed out after ${timeoutMs}ms: ${url}`));
    }, timeoutMs);

    externalSignal?.addEventListener("abort", abortFromCaller, { once: true });

    void (async () => {
      try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        const result = await processResponse(response);

        if (!settled) {
          settled = true;
          cleanup();
          resolve(result);
        }
      } catch (error) {
        rejectOnce(error);
      }
    })();
  });
}

function parseKlines(raw: unknown[]): Candle[] {
  return raw.map((item) => {
    if (!Array.isArray(item) || item.length < 7) {
      throw new Error("Binance returned an invalid kline record.");
    }

    const k = item as BinanceKline;

    return {
      openTime: Number(k[0]),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
      closeTime: Number(k[6]),
    };
  });
}

export async function fetchKlines(
  symbol: string,
  interval: "15m" | "1h" | "4h",
  limit = 500,
  signal?: AbortSignal,
): Promise<Candle[]> {
  const normalizedSymbol = symbol.trim().toUpperCase();

  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 1500);

  const data = await getJSON<unknown[]>(
    `/fapi/v1/klines?symbol=${encodeURIComponent(
      normalizedSymbol,
    )}&interval=${interval}&limit=${safeLimit}`,
    signal,
  );

  return parseKlines(data);
}

export async function fetchPremiumIndex(symbol: string, signal?: AbortSignal) {
  const normalizedSymbol = symbol.trim().toUpperCase();

  const data = await getJSON<PremiumIndexResponse>(
    `/fapi/v1/premiumIndex?symbol=${encodeURIComponent(normalizedSymbol)}`,
    signal,
  );

  const markPrice = Number(data.markPrice);

  const fundingRate = Number(data.lastFundingRate);

  const nextFundingTime = Number(data.nextFundingTime);

  if (!Number.isFinite(markPrice) || markPrice <= 0) {
    throw new Error("Binance returned an invalid mark price.");
  }

  if (!Number.isFinite(fundingRate)) {
    throw new Error("Binance returned an invalid funding rate.");
  }

  if (!Number.isFinite(nextFundingTime)) {
    throw new Error("Binance returned an invalid next funding time.");
  }

  return {
    markPrice,
    fundingRate,
    nextFundingTime,
  };
}

export async function fetchOpenInterestHist(symbol: string, signal?: AbortSignal) {
  const normalizedSymbol = symbol.trim().toUpperCase();

  const data = await getJSON<OpenInterestHistoryItem[]>(
    `/futures/data/openInterestHist?symbol=${encodeURIComponent(
      normalizedSymbol,
    )}&period=15m&limit=30`,
    signal,
  );

  return data
    .map((item) => ({
      time: Number(item.timestamp),
      value: Number(item.sumOpenInterest),
    }))
    .filter((item) => Number.isFinite(item.time) && Number.isFinite(item.value) && item.value >= 0);
}

export async function fetchLongShortRatio(symbol: string, signal?: AbortSignal) {
  const normalizedSymbol = symbol.trim().toUpperCase();

  const data = await getJSON<LongShortRatioItem[]>(
    `/futures/data/globalLongShortAccountRatio?symbol=${encodeURIComponent(
      normalizedSymbol,
    )}&period=15m&limit=1`,
    signal,
  );

  if (data.length === 0) {
    return 1;
  }

  const ratio = Number(data[0]!.longShortRatio);

  if (!Number.isFinite(ratio) || ratio <= 0) {
    return 1;
  }

  return ratio;
}

export async function fetchSnapshot(symbol: string, signal?: AbortSignal): Promise<MarketSnapshot> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);

  if (signal?.aborted) {
    abortFromCaller();
  } else {
    signal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  try {
    const [candles4h, candles1h, candles15m, premium, oiHistory, longShortRatio] =
      await Promise.all([
        fetchKlines(symbol, "4h", 500, controller.signal),
        fetchKlines(symbol, "1h", 500, controller.signal),
        fetchKlines(symbol, "15m", 500, controller.signal),
        fetchPremiumIndex(symbol, controller.signal),
        fetchOpenInterestHist(symbol, controller.signal).catch(() => []),
        fetchLongShortRatio(symbol, controller.signal).catch(() => 1),
      ]);

    const openInterest = oiHistory.length > 0 ? oiHistory[oiHistory.length - 1]!.value : 0;

    return {
      price: premium.markPrice,
      candles4h,
      candles1h,
      candles15m,
      fundingRate: premium.fundingRate,
      nextFundingTime: premium.nextFundingTime,
      openInterest,
      oiHistory,
      longShortRatio,
      fetchedAt: Date.now(),
    };
  } catch (error) {
    controller.abort(error);
    throw error;
  } finally {
    signal?.removeEventListener("abort", abortFromCaller);
  }
}
