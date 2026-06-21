import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { fmtDate, fmtPrice, fmtUSD } from "@/lib/format";
import { store } from "@/lib/storage";
import type { Signal, SignalStatus, JournalEntry } from "@/lib/types";
import { uid } from "@/lib/storage";
import { Trash2 } from "lucide-react";

export const Route = createFileRoute("/journal")({
  head: () => ({
    meta: [
      { title: "Journal — BTC Engine" },
      { name: "description", content: "Trade-Journal mit Entry, SL, TP, PnL, R-Multiple." },
    ],
  }),
  component: JournalPage,
});

const STATUS_TONE: Record<SignalStatus, string> = {
  OPEN: "var(--color-warn)",
  TP1_HIT: "var(--color-bull)",
  TP2_HIT: "var(--color-bull)",
  STOPPED: "var(--color-bear)",
  CANCELLED: "var(--color-neutral)",
};

function JournalPage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [, setEntries] = useState<JournalEntry[]>([]);

  const reload = () => {
    setSignals(store.getSignals());
    setEntries(store.getJournal());
  };

  useEffect(reload, []);

  const closeAt = (sig: Signal, status: SignalStatus, exitPrice: number) => {
    const dir = sig.direction === "LONG" ? 1 : -1;
    const stopDist = Math.abs(sig.entry_price - sig.stop_loss);
    const grossPerCoin = (exitPrice - sig.entry_price) * dir;
    const pnl = grossPerCoin * sig.position_size;
    const r = stopDist > 0 ? grossPerCoin / stopDist : 0;
    store.updateSignal(sig.id, { status });
    store.addJournal({
      id: uid(),
      signal_id: sig.id,
      entry: sig.entry_price,
      exit: exitPrice,
      profit_loss: pnl,
      r_multiple: r,
      duration: Date.now() - sig.timestamp,
      notes: "",
      created_at: Date.now(),
    });
    reload();
  };

  const remove = (id: string) => {
    store.setSignals(store.getSignals().filter((s) => s.id !== id));
    store.setJournal(store.getJournal().filter((j) => j.signal_id !== id));
    reload();
  };

  const journal = store.getJournal();

  return (
    <AppShell title="Journal">
      {signals.length === 0 ? (
        <div className="tile p-6 text-center text-sm text-muted-foreground">
          Noch keine Signale gespeichert.
        </div>
      ) : (
        <div className="space-y-2">
          {signals.map((s) => {
            const j = journal.find((x) => x.signal_id === s.id);
            return (
              <div key={s.id} className="tile p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                      style={{
                        background:
                          s.direction === "LONG"
                            ? "color-mix(in oklch, var(--color-bull) 22%, transparent)"
                            : "color-mix(in oklch, var(--color-bear) 22%, transparent)",
                        color:
                          s.direction === "LONG"
                            ? "var(--color-bull)"
                            : "var(--color-bear)",
                      }}
                    >
                      {s.direction}
                    </span>
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                      style={{
                        background: `${STATUS_TONE[s.status]}22`,
                        color: STATUS_TONE[s.status],
                      }}
                    >
                      {s.status.replace("_", " ")}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {fmtDate(s.timestamp)}
                    </span>
                  </div>
                  <button
                    onClick={() => remove(s.id)}
                    className="text-muted-foreground hover:text-[var(--color-bear)]"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-2 text-[11px]">
                  <Field label="Entry" value={fmtPrice(s.entry_price)} />
                  <Field label="SL" value={fmtPrice(s.stop_loss)} />
                  <Field label="TP1" value={fmtPrice(s.tp1)} />
                  <Field label="TP2" value={fmtPrice(s.tp2)} />
                </div>
                <div className="mt-1 grid grid-cols-3 gap-2 text-[11px]">
                  <Field label="Score" value={`${s.signal_score}`} />
                  <Field label="Risk" value={`${fmtUSD(s.risk_amount)} $`} />
                  <Field
                    label="Size"
                    value={`${s.position_size.toFixed(4)}`}
                  />
                </div>
                {j ? (
                  <div className="mt-2 flex items-center justify-between rounded-md bg-muted/40 px-2 py-1.5 text-xs">
                    <span className="text-muted-foreground">
                      Exit {fmtPrice(j.exit)} · {j.r_multiple.toFixed(2)} R
                    </span>
                    <span
                      className="num font-bold"
                      style={{
                        color:
                          j.profit_loss >= 0
                            ? "var(--color-bull)"
                            : "var(--color-bear)",
                      }}
                    >
                      {j.profit_loss >= 0 ? "+" : ""}
                      {fmtUSD(j.profit_loss)} $
                    </span>
                  </div>
                ) : s.status === "OPEN" ? (
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                    <CloseBtn
                      label="TP1 erreicht"
                      onClick={() => closeAt(s, "TP1_HIT", s.tp1)}
                      color="var(--color-bull)"
                    />
                    <CloseBtn
                      label="TP2 erreicht"
                      onClick={() => closeAt(s, "TP2_HIT", s.tp2)}
                      color="var(--color-bull)"
                    />
                    <CloseBtn
                      label="SL"
                      onClick={() => closeAt(s, "STOPPED", s.stop_loss)}
                      color="var(--color-bear)"
                    />
                    <CloseBtn
                      label="Cancel"
                      onClick={() => {
                        store.updateSignal(s.id, { status: "CANCELLED" });
                        reload();
                      }}
                      color="var(--color-neutral)"
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/30 px-2 py-1">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="num font-semibold">{value}</div>
    </div>
  );
}

function CloseBtn({
  label,
  onClick,
  color,
}: {
  label: string;
  onClick: () => void;
  color: string;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-md px-2.5 py-1 font-semibold transition-colors"
      style={{
        background: `${color}1f`,
        color,
      }}
    >
      {label}
    </button>
  );
}