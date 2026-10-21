import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { LayerRow } from "@/components/layer-row";
import { MetricTile } from "@/components/metric-tile";
import { ScoreGauge } from "@/components/score-gauge";
import { useEngine } from "@/hooks/use-engine";
import { fmtCompact, fmtPct, fmtPrice, fmtTime, fmtUSD } from "@/lib/format";
import { store, type AppSettings } from "@/lib/storage";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Live Dashboard — BTC Engine" },
      { name: "description", content: "Live BTCUSDT Score, Trend, Struktur & Risikoanalyse." },
      { property: "og:title", content: "Live Dashboard — BTC Engine" },
      {
        property: "og:description",
        content: "Live BTCUSDT Score, Trend, Struktur & Risikoanalyse.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => setSettings(store.getSettings()), []);
  if (!settings) return null;
  return <Dashboard settings={settings} />;
}

function Dashboard({ settings }: { settings: AppSettings }) {
  const { result, loading, error, lastUpdate } = useEngine(settings);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <AppShell
      title="Live Dashboard"
      right={
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <span className="size-1.5 rounded-full bg-[var(--color-bull)]" />
          )}
          <span className="num">
            {lastUpdate
              ? `${now - lastUpdate < 45_000 ? "LIVE" : now - lastUpdate < 120_000 ? "STALE" : "OFFLINE"} · ${fmtTime(lastUpdate)}`
              : "OFFLINE · —"}
          </span>
          {lastUpdate && now - lastUpdate >= 120_000 && (
            <div className="text-xs text-muted-foreground">
              Forward-Test pausiert: Engine seit über 2 Minuten ohne Update. Chromebook, Browser
              oder Workspace prüfen.
            </div>
          )}
        </div>
      }
    >
      {error ? (
        <div className="tile mb-4 border-[var(--color-bear)]/30 bg-[var(--color-bear)]/5 p-3 text-sm text-[var(--color-bear)]">
          Datenfehler: {error}
        </div>
      ) : null}

      {!result ? (
        <div className="grid place-items-center py-20 text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
          <div className="mt-3 text-sm">Lade Marktdaten…</div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Price banner */}
          <div className="tile flex items-end justify-between p-4">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {settings.symbol} · Mark Price
              </div>
              <div className="num text-3xl font-bold">
                {fmtPrice(result.price)}{" "}
                <span className="text-base text-muted-foreground">USDT</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Funding
              </div>
              <div
                className="num text-base font-semibold"
                style={{
                  color:
                    result.market.fundingRate > 0.0005
                      ? "var(--color-warn)"
                      : "var(--color-foreground)",
                }}
              >
                {(result.market.fundingRate * 100).toFixed(4)}%
              </div>
            </div>
          </div>

          <div className="mb-4 rounded-lg border px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Data Health</span>
              <span className="text-sm font-semibold">{result.dataHealth.status}</span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {result.dataHealth.checks.find((check) => check.status === "FAIL")?.detail ??
                result.dataHealth.checks.find((check) => check.status === "WARN")?.detail ??
                "Marktdaten sind aktuell und valid."}
            </div>
          </div>

          <ScoreGauge
            score={result.score}
            decision={result.decision}
            direction={result.direction}
          />

          {/* Layers */}
          <div className="tile p-3">
            <div className="mb-1 px-1 text-[11px] uppercase tracking-wider text-muted-foreground">
              6-Layer Decision
            </div>
            {result.layers.map((l) => (
              <LayerRow key={l.name} layer={l} />
            ))}
          </div>

          {/* Trade plan */}
          <div
            className="tile p-4"
            style={{
              borderColor: result.trade
                ? result.trade.direction === "LONG"
                  ? "color-mix(in oklch, var(--color-bull) 40%, transparent)"
                  : "color-mix(in oklch, var(--color-bear) 40%, transparent)"
                : "var(--color-border)",
            }}
          >
            <div className="flex items-center justify-between">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Trade-Plan
              </div>
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                style={{
                  background: !result.trade
                    ? "color-mix(in oklch, var(--color-muted-foreground) 18%, transparent)"
                    : result.trade.direction === "LONG"
                      ? "color-mix(in oklch, var(--color-bull) 22%, transparent)"
                      : "color-mix(in oklch, var(--color-bear) 22%, transparent)",
                  color: !result.trade
                    ? "var(--color-muted-foreground)"
                    : result.trade.direction === "LONG"
                      ? "var(--color-bull)"
                      : "var(--color-bear)",
                }}
              >
                {result.trade ? result.trade.direction : "NO TRADE"}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <MetricTile label="Entry" value={result.trade ? fmtPrice(result.trade.entry) : "—"} />
              <MetricTile
                label="Stop"
                tone="bear"
                value={result.trade ? fmtPrice(result.trade.stop) : "—"}
              />
              <MetricTile
                label="TP1"
                tone="bull"
                value={result.trade ? fmtPrice(result.trade.tp1) : "—"}
              />
              <MetricTile
                label="TP2"
                tone="bull"
                value={result.trade ? fmtPrice(result.trade.tp2) : "—"}
              />
              <MetricTile
                label="Risiko"
                value={result.trade ? `${fmtUSD(result.trade.risk.riskAmount)} $` : "—"}
                hint="Maximaler Verlust bei Stop-Loss"
              />
              <MetricTile
                label="Chance / Risiko"
                value="TP1 1 : 1,50 · TP2 1 : 3,00"
                hint="Wie viel Gewinn pro 1 $ Risiko möglich ist"
              />
              <MetricTile
                label="Break-even"
                value="TP1 40 % · TP2 25 %"
                hint="Theoretische Trefferquote, ohne Gebühren & Slippage"
              />
              <MetricTile
                label="Größe"
                value={result.trade ? `${result.trade.risk.positionSize.toFixed(4)} BTC` : "—"}
                hint={
                  result.trade
                    ? `${result.trade.risk.leverage}× Hebel`
                    : "Erst bei gültigem Trade berechnet"
                }
              />
            </div>
          </div>

          {/* Market metrics */}
          <div className="grid grid-cols-2 gap-2">
            <MetricTile
              label="Trend (1H)"
              tone={
                result.direction === "LONG"
                  ? "bull"
                  : result.direction === "SHORT"
                    ? "bear"
                    : "neutral"
              }
              value={
                result.direction === "LONG"
                  ? "Bullisch"
                  : result.direction === "SHORT"
                    ? "Bärisch"
                    : "Neutral"
              }
              hint={`EMA200 ${fmtPrice(result.market.ema200)}`}
            />
            <MetricTile
              label="RSI 14 (15M)"
              tone={
                result.market.rsi15m > 70 ? "warn" : result.market.rsi15m < 30 ? "warn" : "default"
              }
              value={result.market.rsi15m.toFixed(1)}
            />
            <MetricTile
              label="ATR 14"
              value={fmtPrice(result.market.atr15m)}
              hint="Volatilität (15M)"
            />
            <MetricTile
              label="Open Interest"
              tone={result.market.oiChangePct > 0 ? "bull" : "bear"}
              value={fmtCompact(result.market.openInterest)}
              hint={fmtPct(result.market.oiChangePct)}
            />
            <MetricTile
              label="Long/Short Ratio"
              tone={
                result.market.longShortRatio > 1.2
                  ? "warn"
                  : result.market.longShortRatio < 0.8
                    ? "warn"
                    : "default"
              }
              value={result.market.longShortRatio.toFixed(2)}
            />
            <MetricTile
              label="Liquidity Risk"
              tone={
                result.liquidityRiskScore > 75
                  ? "bear"
                  : result.liquidityRiskScore > 40
                    ? "warn"
                    : "bull"
              }
              value={`${result.liquidityRiskScore}/100`}
            />
          </div>

          {/* Reasoning */}
          <div className="tile p-3">
            <div className="px-1 text-[11px] uppercase tracking-wider text-muted-foreground">
              Begründung
            </div>
            <ul className="mt-2 space-y-1.5">
              {result.reasoning.map((r, i) => (
                <li key={i} className="flex gap-2 text-sm text-foreground/90">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </AppShell>
  );
}
