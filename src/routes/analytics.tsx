import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { MetricTile } from "@/components/metric-tile";
import { fmtPct, fmtUSD } from "@/lib/format";
import { store } from "@/lib/storage";
import type { JournalEntry } from "@/lib/types";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Analyse — BTC Engine" },
      { name: "description", content: "Win-Rate, Profit Factor, Expectancy, Drawdown & Strategy Health." },
    ],
  }),
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const [j, setJ] = useState<JournalEntry[]>([]);
  useEffect(() => setJ(store.getJournal()), []);

  const stats = useMemo(() => computeStats(j), [j]);
  const health = useMemo(() => strategyHealth(stats), [stats]);

  return (
    <AppShell title="Analyse">
      <div className="space-y-3">
        <HealthCard score={health.score} label={health.label} tone={health.tone} />
        <div className="grid grid-cols-2 gap-2">
          <MetricTile label="Trades" value={stats.count.toString()} />
          <MetricTile
            label="Win Rate"
            tone={stats.winrate >= 50 ? "bull" : "bear"}
            value={`${stats.winrate.toFixed(1)}%`}
          />
          <MetricTile
            label="Profit Factor"
            tone={stats.profitFactor >= 1.5 ? "bull" : stats.profitFactor >= 1 ? "warn" : "bear"}
            value={
              stats.profitFactor >= 99
                ? "∞"
                : stats.profitFactor.toFixed(2)
            }
          />
          <MetricTile
            label="Expectancy"
            tone={stats.expectancy >= 0 ? "bull" : "bear"}
            value={`${fmtUSD(stats.expectancy)} $`}
          />
          <MetricTile
            label="Avg Win"
            tone="bull"
            value={`${fmtUSD(stats.avgWin)} $`}
          />
          <MetricTile
            label="Avg Loss"
            tone="bear"
            value={`${fmtUSD(stats.avgLoss)} $`}
          />
          <MetricTile
            label="Drawdown"
            tone="bear"
            value={fmtPct(-stats.maxDD)}
          />
          <MetricTile
            label="Total PnL"
            tone={stats.totalPnL >= 0 ? "bull" : "bear"}
            value={`${fmtUSD(stats.totalPnL)} $`}
          />
        </div>

        <div className="tile p-3">
          <div className="px-1 text-[11px] uppercase tracking-wider text-muted-foreground">
            Beste Setups
          </div>
          <div className="mt-2 space-y-1.5 text-sm">
            {stats.count === 0 ? (
              <div className="text-muted-foreground">
                Noch keine geschlossenen Trades.
              </div>
            ) : (
              <>
                <Row
                  label="LONG"
                  value={`${stats.long.count} Trades · ${stats.long.winrate.toFixed(0)}% WR`}
                />
                <Row
                  label="SHORT"
                  value={`${stats.short.count} Trades · ${stats.short.winrate.toFixed(0)}% WR`}
                />
              </>
            )}
          </div>
        </div>

        <div className="tile p-3 text-xs text-muted-foreground">
          Marktbedingungen (manuell verfolgen): Trends/Range, Funding-Regime, hohe vs. niedrige Volatilität.
        </div>
      </div>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-muted/30 px-2 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="num font-semibold">{value}</span>
    </div>
  );
}

function HealthCard({
  score,
  label,
  tone,
}: {
  score: number;
  label: string;
  tone: string;
}) {
  return (
    <div className="tile p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Strategy Health
          </div>
          <div className="num mt-1 text-3xl font-bold" style={{ color: tone }}>
            {score}
          </div>
          <div className="text-xs font-semibold" style={{ color: tone }}>
            {label}
          </div>
        </div>
        <div className="text-right text-[11px] text-muted-foreground">
          90+ stabil · 80–89 ok · 70–79 watch
          <br />
          &lt;70 risk · &lt;60 deaktivieren
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${score}%`, background: tone }}
        />
      </div>
    </div>
  );
}

function computeStats(j: JournalEntry[]) {
  const count = j.length;
  const wins = j.filter((x) => x.profit_loss > 0);
  const losses = j.filter((x) => x.profit_loss <= 0);
  const grossWin = wins.reduce((s, x) => s + x.profit_loss, 0);
  const grossLoss = Math.abs(losses.reduce((s, x) => s + x.profit_loss, 0));
  const winrate = count ? (wins.length / count) * 100 : 0;
  const profitFactor =
    grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0;
  const expectancy = count ? j.reduce((s, x) => s + x.profit_loss, 0) / count : 0;
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? -grossLoss / losses.length : 0;
  const totalPnL = j.reduce((s, x) => s + x.profit_loss, 0);

  // Drawdown on cumulative equity series in chronological order
  const sorted = [...j].sort((a, b) => a.created_at - b.created_at);
  let eq = 0;
  let peak = 0;
  let maxDD = 0;
  for (const t of sorted) {
    eq += t.profit_loss;
    if (eq > peak) peak = eq;
    const dd = peak > 0 ? ((peak - eq) / Math.max(peak, 1)) * 100 : 0;
    if (dd > maxDD) maxDD = dd;
  }

  const splitStats = (arr: JournalEntry[]) => {
    const w = arr.filter((x) => x.profit_loss > 0);
    return {
      count: arr.length,
      winrate: arr.length ? (w.length / arr.length) * 100 : 0,
    };
  };

  // We don't track direction in journal, infer from sign of r_multiple is unreliable;
  // join with signals to split LONG/SHORT.
  const signals = store.getSignals();
  const byId = new Map(signals.map((s) => [s.id, s]));
  const longArr = j.filter((x) => byId.get(x.signal_id)?.direction === "LONG");
  const shortArr = j.filter((x) => byId.get(x.signal_id)?.direction === "SHORT");

  return {
    count,
    winrate,
    profitFactor,
    expectancy,
    avgWin,
    avgLoss,
    maxDD,
    totalPnL,
    long: splitStats(longArr),
    short: splitStats(shortArr),
  };
}

function strategyHealth(s: ReturnType<typeof computeStats>) {
  // Heuristic: weighted on PF, WR, expectancy, drawdown.
  if (s.count < 5) {
    return {
      score: 75,
      label: "Zu wenig Daten — Watch",
      tone: "var(--color-warn)",
    };
  }
  let score = 50;
  score += Math.min(20, (s.profitFactor - 1) * 20);
  score += Math.min(15, (s.winrate - 40) / 2);
  score += s.expectancy > 0 ? 10 : -10;
  score -= Math.min(15, s.maxDD / 2);
  score = Math.max(0, Math.min(100, Math.round(score)));
  let label = "Risk";
  let tone = "var(--color-bear)";
  if (score >= 90) {
    label = "Stabil";
    tone = "var(--color-bull)";
  } else if (score >= 80) {
    label = "Ok";
    tone = "var(--color-bull)";
  } else if (score >= 70) {
    label = "Watch";
    tone = "var(--color-warn)";
  } else if (score < 60) {
    label = "Strategie deaktivieren";
    tone = "var(--color-bear)";
  }
  return { score, label, tone };
}