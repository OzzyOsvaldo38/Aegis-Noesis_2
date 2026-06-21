import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { MetricTile } from "@/components/metric-tile";
import { useEngine } from "@/hooks/use-engine";
import { fmtPrice, fmtUSD } from "@/lib/format";
import { store, type AppSettings } from "@/lib/storage";
import { Calculator } from "lucide-react";

export const Route = createFileRoute("/risk-rechner")({
  head: () => ({
    meta: [
      { title: "Risk Calculator — BTC Engine" },
      { name: "description", content: "Position Size, Stop Loss und Take Profit Rechner." },
    ],
  }),
  component: RiskRechner,
});

function RiskRechner() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => setSettings(store.getSettings()), []);
  if (!settings) return null;
  return <Inner settings={settings} />;
}

function Inner({ settings }: { settings: AppSettings }) {
  const { result } = useEngine(settings);
  const user = useMemo(() => store.getUser(), []);

  const [accountSize, setAccountSize] = useState(user.account_size);
  const [riskPerTrade, setRiskPerTrade] = useState(user.risk_per_trade);
  const [direction, setDirection] = useState<"LONG" | "SHORT">("LONG");
  const [entryPrice, setEntryPrice] = useState<number>(result?.price ?? 0);
  const [stopPrice, setStopPrice] = useState<number>(0);

  useEffect(() => {
    if (result?.price && entryPrice === 0) {
      setEntryPrice(result.price);
    }
  }, [result?.price]);

  const calc = useMemo(() => {
    const riskAmount = accountSize * (riskPerTrade / 100);
    const stopDist = Math.abs(entryPrice - stopPrice);
    const positionSize = stopDist > 0 ? riskAmount / stopDist : 0;
    const tp1 = direction === "LONG" ? entryPrice + stopDist * 1.5 : entryPrice - stopDist * 1.5;
    const tp2 = direction === "LONG" ? entryPrice + stopDist * 3 : entryPrice - stopDist * 3;
    const leverage = entryPrice > 0 && positionSize > 0 ? (entryPrice * positionSize) / accountSize : 0;
    const crv = stopDist > 0 ? Math.abs(tp1 - entryPrice) / stopDist : 0;

    return {
      riskAmount,
      stopDist,
      positionSize,
      tp1,
      tp2,
      leverage,
      crv,
      valid: stopDist > 0 && entryPrice > 0,
    };
  }, [accountSize, riskPerTrade, direction, entryPrice, stopPrice]);

  return (
    <AppShell
      title="Risk Calculator"
      right={
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Calculator className="size-3.5" />
          <span>Manuell</span>
        </div>
      }
    >
      <div className="space-y-3">
        {/* Inputs */}
        <div className="tile p-4 space-y-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Eingaben
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Account Size (USDT)</label>
              <input
                type="number"
                value={accountSize}
                onChange={(e) => setAccountSize(Number(e.target.value))}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm num"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Risk / Trade (%)</label>
              <input
                type="number"
                step={0.1}
                value={riskPerTrade}
                onChange={(e) => setRiskPerTrade(Number(e.target.value))}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm num"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Richtung</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setDirection("LONG")}
                className={`rounded-md border px-3 py-2 text-sm font-semibold transition-colors ${
                  direction === "LONG"
                    ? "border-[var(--color-bull)] bg-[var(--color-bull)]/10 text-[var(--color-bull)]"
                    : "border-input text-muted-foreground hover:text-foreground"
                }`}
              >
                LONG
              </button>
              <button
                onClick={() => setDirection("SHORT")}
                className={`rounded-md border px-3 py-2 text-sm font-semibold transition-colors ${
                  direction === "SHORT"
                    ? "border-[var(--color-bear)] bg-[var(--color-bear)]/10 text-[var(--color-bear)]"
                    : "border-input text-muted-foreground hover:text-foreground"
                }`}
              >
                SHORT
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Entry Price</label>
              <input
                type="number"
                value={entryPrice}
                onChange={(e) => setEntryPrice(Number(e.target.value))}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm num"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Stop Loss</label>
              <input
                type="number"
                value={stopPrice}
                onChange={(e) => setStopPrice(Number(e.target.value))}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm num"
              />
            </div>
          </div>

          {result?.price ? (
            <button
              onClick={() => {
                setEntryPrice(result.price);
                if (direction === "LONG" && result.trade?.stop) {
                  setStopPrice(result.trade.stop);
                } else if (direction === "SHORT" && result.trade?.stop) {
                  setStopPrice(result.trade.stop);
                }
              }}
              className="w-full rounded-md border border-input bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Aktuelles Engine-Ergebnis übernehmen
            </button>
          ) : null}
        </div>

        {/* Results */}
        {calc.valid ? (
          <div
            className="tile p-4"
            style={{
              borderColor:
                direction === "LONG"
                  ? "color-mix(in oklch, var(--color-bull) 40%, transparent)"
                  : "color-mix(in oklch, var(--color-bear) 40%, transparent)",
            }}
          >
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Ergebnis
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <MetricTile
                label="Max. Verlust"
                value={`${fmtUSD(calc.riskAmount)} USDT`}
                hint={`${riskPerTrade}% vom Account`}
              />
              <MetricTile
                label="Position Size"
                value={`${calc.positionSize.toFixed(6)} BTC`}
                hint={`≈ ${fmtUSD(calc.positionSize * entryPrice)} USDT Nominal`}
              />
              <MetricTile
                label="Stop-Distanz"
                value={`${fmtPrice(calc.stopDist)} USDT`}
              />
              <MetricTile
                label="Eff. Hebel"
                value={`${calc.leverage.toFixed(1)}×`}
                hint={calc.leverage > user.default_leverage ? `>${user.default_leverage}× — Achtung!` : "Ok"}
                tone={calc.leverage > user.default_leverage ? "warn" : "default"}
              />
              <MetricTile label="TP1 (1.5R)" tone="bull" value={fmtPrice(calc.tp1)} />
              <MetricTile label="TP2 (3R)" tone="bull" value={fmtPrice(calc.tp2)} />
              <MetricTile label="CRV" value={calc.crv.toFixed(2)} />
              <MetricTile
                label="R-Ratio"
                value={`1:${calc.crv.toFixed(2)}`}
              />
            </div>
          </div>
        ) : (
          <div className="tile p-4 text-sm text-muted-foreground">
            Gib Entry Price und Stop Loss ein, um die Berechnung zu sehen.
          </div>
        )}

        {/* Quick preset */}
        <div className="tile p-4 space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Schnellauswahl Risk %
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[0.5, 1, 1.5, 2].map((pct) => (
              <button
                key={pct}
                onClick={() => setRiskPerTrade(pct)}
                className={`rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                  riskPerTrade === pct
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input text-muted-foreground hover:text-foreground"
                }`}
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
