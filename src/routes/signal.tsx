import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { LayerRow } from "@/components/layer-row";
import { MetricTile } from "@/components/metric-tile";
import { useEngine } from "@/hooks/use-engine";
import { fmtPct, fmtPrice, fmtUSD } from "@/lib/format";
import { store, type AppSettings } from "@/lib/storage";
import { uid } from "@/lib/storage";
import type { Signal } from "@/lib/types";

export const Route = createFileRoute("/signal")({
  head: () => ({
    meta: [
      { title: "Aktuelles Signal — BTC Engine" },
      { name: "description", content: "Detailansicht des aktuellen Signals: Score, Layer, Trade-Plan." },
    ],
  }),
  component: SignalPage,
});

function SignalPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => setSettings(store.getSettings()), []);
  if (!settings) return null;
  return <Inner settings={settings} />;
}

function Inner({ settings }: { settings: AppSettings }) {
  const { result } = useEngine(settings);
  const user = useMemo(() => store.getUser(), []);

  const saveSignal = () => {
    if (!result?.trade) return;
    const sig: Signal = {
      id: uid(),
      timestamp: result.ts,
      symbol: settings.symbol,
      direction: result.trade.direction,
      entry_price: result.trade.entry,
      stop_loss: result.trade.stop,
      tp1: result.trade.tp1,
      tp2: result.trade.tp2,
      signal_score: result.score,
      manipulation_score: result.manipulationScore,
      trend_status: result.layers.find((l) => l.name === "Trend")?.detail ?? "",
      structure_status:
        result.layers.find((l) => l.name === "Struktur")?.detail ?? "",
      funding_rate: result.market.fundingRate,
      open_interest: result.market.openInterest,
      risk_amount: result.trade.riskAmount,
      position_size: result.trade.positionSize,
      leverage: user.default_leverage,
      status: "OPEN",
    };
    store.addSignal(sig);
    alert("Signal im Journal gespeichert.");
  };

  return (
    <AppShell title="Aktuelles Signal">
      {!result ? (
        <div className="tile p-6 text-center text-muted-foreground">Lade…</div>
      ) : (
        <div className="space-y-3">
          <div className="tile p-4">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Status
            </div>
            <div className="mt-1 text-2xl font-bold">
              {result.decision === "STRONG_SIGNAL"
                ? "Starkes Signal"
                : result.decision === "SIGNAL"
                  ? "Signal"
                  : "Kein Trade"}
            </div>
            <div className="text-sm text-muted-foreground">
              Score {result.score}/100 · Richtung {result.direction}
            </div>
          </div>

          {result.trade ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <MetricTile label="Entry" value={fmtPrice(result.trade.entry)} />
                <MetricTile
                  label="Stop Loss"
                  tone="bear"
                  value={fmtPrice(result.trade.stop)}
                />
                <MetricTile label="TP1 (1.5R)" tone="bull" value={fmtPrice(result.trade.tp1)} />
                <MetricTile label="TP2 (3R)" tone="bull" value={fmtPrice(result.trade.tp2)} />
                <MetricTile
                  label="Risk"
                  value={`${fmtUSD(result.trade.riskAmount)} $`}
                  hint={`${user.risk_per_trade}% von ${fmtUSD(user.account_size)} $`}
                />
                <MetricTile
                  label="Position"
                  value={`${result.trade.positionSize.toFixed(4)} BTC`}
                  hint={`${user.default_leverage}× Hebel`}
                />
                <MetricTile label="CRV" value={result.trade.crv.toFixed(2)} />
                <MetricTile
                  label="Funding"
                  value={`${(result.market.fundingRate * 100).toFixed(4)}%`}
                />
              </div>
              <button
                onClick={saveSignal}
                className="w-full rounded-md bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                Signal ins Journal speichern
              </button>
            </>
          ) : (
            <div className="tile p-4 text-sm text-muted-foreground">
              Kein gültiges Setup. Default-Regel: <span className="text-foreground font-semibold">NO TRADE</span>.
            </div>
          )}

          <div className="tile p-3">
            <div className="px-1 text-[11px] uppercase tracking-wider text-muted-foreground">
              Layer-Details
            </div>
            {result.layers.map((l) => (
              <LayerRow key={l.name} layer={l} />
            ))}
          </div>

          <div className="tile p-3">
            <div className="px-1 text-[11px] uppercase tracking-wider text-muted-foreground">
              Score-Aufschlüsselung
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {Object.entries(result.scores).map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-center justify-between rounded-md bg-muted/40 px-2.5 py-1.5 text-xs"
                >
                  <span className="capitalize text-muted-foreground">{k}</span>
                  <span className="num font-semibold">{v}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="tile p-3">
            <div className="px-1 text-[11px] uppercase tracking-wider text-muted-foreground">
              Begründung
            </div>
            <ul className="mt-2 space-y-1.5 text-sm">
              {result.reasoning.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 text-xs text-muted-foreground">
              OI-Änderung {fmtPct(result.market.oiChangePct)} · L/S{" "}
              {result.market.longShortRatio.toFixed(2)} · Manipulation{" "}
              {result.manipulationScore}/100
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}