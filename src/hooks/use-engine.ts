import { useEffect, useRef, useState } from "react";
import { fetchSnapshot } from "@/lib/binance";
import { evaluate } from "@/lib/engine";
import { notify } from "@/lib/notifications";
import { store, type AppSettings } from "@/lib/storage";
import type { EngineResult, MarketSnapshot } from "@/lib/types";

interface UseEngineState {
  result: EngineResult | null;
  market: MarketSnapshot | null;
  loading: boolean;
  error: string | null;
  lastUpdate: number;
}

export function useEngine(settings: AppSettings) {
  const [state, setState] = useState<UseEngineState>({
    result: null,
    market: null,
    loading: true,
    error: null,
    lastUpdate: 0,
  });
  const lastNotifiedTs = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const market = await fetchSnapshot(settings.symbol);
        if (cancelled) return;
        const user = store.getUser();
        const result = evaluate(market, user, settings);
        setState({
          result,
          market,
          loading: false,
          error: null,
          lastUpdate: Date.now(),
        });
        // Browser push if all filters passed and >= minScore
        if (
          settings.notifyEnabled &&
          (result.decision === "SIGNAL" || result.decision === "STRONG_SIGNAL") &&
          result.ts - lastNotifiedTs.current > 60000
        ) {
          lastNotifiedTs.current = result.ts;
          notify(
            `BTCUSDT ${result.direction} · Score ${result.score}`,
            result.trade
              ? `Entry ${result.trade.entry.toFixed(2)} · SL ${result.trade.stop.toFixed(2)} · TP ${result.trade.tp1.toFixed(2)}`
              : "Setup erkannt",
          );
        }
      } catch (e) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: e instanceof Error ? e.message : "Fehler beim Laden",
        }));
      } finally {
        if (!cancelled) {
          timer = setTimeout(tick, settings.pollMs);
        }
      }
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [settings.symbol, settings.pollMs, settings.notifyEnabled, settings.minScore]);

  return state;
}