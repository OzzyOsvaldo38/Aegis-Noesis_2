import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/components/app-shell";
import { MetricTile } from "@/components/metric-tile";
import { runBacktest, fetchHistory, type BacktestResult } from "@/lib/backtest";
import { fmtPct, fmtUSD } from "@/lib/format";
import { store } from "@/lib/storage";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/backtest")({
  head: () => ({
    meta: [
      { title: "Backtest — BTC Engine" },
      { name: "description", content: "Client-seitiges Backtesting mit Fees, Slippage und Funding." },
    ],
  }),
  component: BacktestPage,
});

const PRESETS = [30, 90, 180, 365] as const;

function BacktestPage() {
  const [days, setDays] = useState<number>(90);
  const [feeBps, setFeeBps] = useState(4); // 0.04%
  const [slipBps, setSlipBps] = useState(2);
  const [funding, setFunding] = useState(0.0001);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<BacktestResult | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const settings = store.getSettings();
      const user = store.getUser();
      const candles = await fetchHistory(settings.symbol, days);
      if (candles.length < 250) throw new Error("Zu wenig Daten geladen.");
      const r = runBacktest({
        candles,
        accountSize: user.account_size,
        riskPct: user.risk_per_trade,
        feeBps,
        slippageBps: slipBps,
        fundingRateAvg: funding,
        rrTp1: 1.5,
        rrTp2: 3,
      });
      setRes(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backtest-Fehler");
    } finally {
      setRunning(false);
    }
  };

  const equityData = res
    ? res.equity
        .filter((_, i) => i % Math.max(1, Math.floor(res.equity.length / 200)) === 0)
        .map((p) => ({
          time: new Date(p.time).toLocaleDateString("de-DE", {
            month: "2-digit",
            day: "2-digit",
          }),
          eq: Number(p.value.toFixed(2)),
        }))
    : [];

  return (
    <AppShell title="Backtest">
      <div className="space-y-3">
        <div className="tile p-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Zeitraum
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PRESETS.map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={
                  "rounded-md px-3 py-1.5 text-xs font-semibold " +
                  (d === days
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground")
                }
              >
                {d} Tage
              </button>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
            <NumField label="Fee bps" value={feeBps} onChange={setFeeBps} />
            <NumField label="Slippage bps" value={slipBps} onChange={setSlipBps} />
            <NumField
              label="Ø Funding (8h)"
              value={funding}
              step={0.00005}
              onChange={setFunding}
            />
          </div>

          <button
            onClick={run}
            disabled={running}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {running ? <Loader2 className="size-4 animate-spin" /> : null}
            {running ? "Läuft…" : "Backtest starten"}
          </button>
          {error ? (
            <div className="mt-2 text-xs text-[var(--color-bear)]">{error}</div>
          ) : null}
        </div>

        {res ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <MetricTile
                label="End-Equity"
                tone={res.finalEquity >= 100 ? "bull" : "bear"}
                value={`${fmtUSD(res.finalEquity)} $`}
              />
              <MetricTile label="Trades" value={res.trades.length.toString()} />
              <MetricTile
                label="Win Rate"
                tone={res.winrate >= 50 ? "bull" : "bear"}
                value={`${res.winrate.toFixed(1)}%`}
              />
              <MetricTile
                label="Profit Factor"
                tone={res.profitFactor >= 1.5 ? "bull" : res.profitFactor >= 1 ? "warn" : "bear"}
                value={
                  res.profitFactor >= 99 ? "∞" : res.profitFactor.toFixed(2)
                }
              />
              <MetricTile
                label="Max Drawdown"
                tone="bear"
                value={fmtPct(-res.maxDD)}
              />
              <MetricTile
                label="Expectancy"
                tone={res.expectancy >= 0 ? "bull" : "bear"}
                value={`${fmtUSD(res.expectancy)} $`}
              />
              <MetricTile label="Sharpe" value={res.sharpe.toFixed(2)} />
              <MetricTile label="Sortino" value={res.sortino.toFixed(2)} />
            </div>

            <div className="tile p-3">
              <div className="px-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                Equity-Kurve
              </div>
              <div className="mt-2 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={equityData}>
                    <defs>
                      <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="0%"
                          stopColor="var(--color-primary)"
                          stopOpacity={0.5}
                        />
                        <stop
                          offset="100%"
                          stopColor="var(--color-primary)"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="time"
                      tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                      stroke="var(--color-border)"
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                      stroke="var(--color-border)"
                      domain={["auto", "auto"]}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--color-surface)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                      labelStyle={{ color: "var(--color-muted-foreground)" }}
                    />
                    <Area
                      type="monotone"
                      dataKey="eq"
                      stroke="var(--color-primary)"
                      strokeWidth={2}
                      fill="url(#eq)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="tile p-3 text-xs text-muted-foreground">
              Live-vs-Backtest: Drift wird signalisiert, sobald deine geschlossenen
              Live-Trades um &gt;30% von der Backtest-Win-Rate abweichen
              (Overfitting-Warnung). Vergleichswert Backtest WR{" "}
              <span className="text-foreground">{res.winrate.toFixed(1)}%</span>.
            </div>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

function NumField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="num mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </label>
  );
}