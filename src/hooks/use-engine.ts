import {
  useEffect,
  useRef,
  useState,
} from "react";

import { fetchSnapshot } from "@/lib/binance";
import { evaluate } from "@/lib/engine";
import { notify } from "@/lib/notifications";
import {
  store,
  type AppSettings,
} from "@/lib/storage";
import type {
  EngineResult,
  MarketSnapshot,
} from "@/lib/types";

interface UseEngineState {
  result: EngineResult | null;
  market: MarketSnapshot | null;
  loading: boolean;
  error: string | null;
  lastUpdate: number;
}

export function useEngine(
  settings: AppSettings,
) {
  const [state, setState] =
    useState<UseEngineState>({
      result: null,
      market: null,
      loading: true,
      error: null,
      lastUpdate: 0,
    });

  const lastNotifiedTs =
    useRef<number>(0);
  const lastNotifiedFingerprint =
    useRef<string>("");

  useEffect(() => {
    let cancelled = false;

    let timer:
      | ReturnType<typeof setTimeout>
      | null = null;

    const tick = async () => {
      try {
        const market =
          await fetchSnapshot(
            settings.symbol,
          );

        if (cancelled) {
          return;
        }

        const user =
          store.getUser();

        const result =
          evaluate(
            market,
            user,
            settings,
          );

        if (cancelled) {
          return;
        }

        setState({
          result,
          market,
          loading: false,
          error: null,
          lastUpdate: Date.now(),
        });

        /*
         * Notifications are allowed only when:
         *
         * 1. Notifications are enabled.
         * 2. Data Health is HEALTHY.
         * 3. The engine produced an actual signal.
         * 4. A trade plan exists.
         * 5. At least 60 seconds passed since
         *    the previous notification.
         *
         * NO_TRADE can therefore never trigger
         * a signal notification.
         */

        const signalDetected =
          result.decision ===
            "SIGNAL" ||
          result.decision ===
            "STRONG_SIGNAL";

        const dataHealthy =
          result.dataHealth.status ===
          "HEALTHY";

        const hasTrade =
          result.trade !== undefined;

        if (
          settings.notifyEnabled &&
          dataHealthy &&
          signalDetected &&
          hasTrade
        ) {
          const signalFingerprint = [
            settings.symbol,
            result.decision,
            result.trade!.direction,
            result.trade!.entry,
            result.trade!.stop,
            result.trade!.tp1,
            result.trade!.tp2,
          ].join("|");

          const isNewSignal =
            signalFingerprint !==
            lastNotifiedFingerprint.current;
          const cooldownPassed =
            result.ts -
              lastNotifiedTs.current >
            60_000;

          if (
            !isNewSignal ||
            !cooldownPassed
          ) {
            return;
          }

          lastNotifiedTs.current =
            result.ts;
          lastNotifiedFingerprint.current =
            signalFingerprint;

          const trade =
            result.trade!;

          notify(
            `${settings.symbol} ${result.direction} · Score ${result.score}`,
            `Entry ${trade.entry.toFixed(2)} · SL ${trade.stop.toFixed(2)} · TP1 ${trade.tp1.toFixed(2)}`,
          );
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        setState((previous) => ({
          ...previous,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "Fehler beim Laden der Marktdaten.",
        }));
      } finally {
        if (!cancelled) {
          timer =
            setTimeout(
              tick,
              settings.pollMs,
            );
        }
      }
    };

    void tick();

    return () => {
      cancelled = true;

      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, [
    settings.symbol,
    settings.pollMs,
    settings.notifyEnabled,
    settings.minScore,
  ]);

  return state;
}