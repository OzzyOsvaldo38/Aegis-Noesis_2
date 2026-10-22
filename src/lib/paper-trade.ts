import type { JournalEntry, Signal } from "@/lib/types";

export type PaperOutcome = "NONE" | "TP1_HIT" | "TP2_HIT" | "STOPPED";

export interface PaperTradeResult {
  exitPrice: number;
  profitLoss: number;
  rMultiple: number;
}

interface PaperTradeStore {
  getSignals: () => Signal[];
  getJournal: () => JournalEntry[];
  updateSignal: (id: string, patch: Partial<Signal>) => void;
  addJournal: (entry: JournalEntry) => void;
}

export function closePaperTrade(
  tradeStore: PaperTradeStore,
  signalId: string,
  outcome: "TP2_HIT" | "STOPPED",
  journalId: string,
): boolean {
  const signal = tradeStore.getSignals().find((item) => item.id === signalId);

  if (
    !signal ||
    (signal.status !== "OPEN" && signal.status !== "TP1_HIT") ||
    tradeStore.getJournal().some((entry) => entry.signal_id === signalId)
  ) {
    return false;
  }

  const result = calculatePaperTradeResult(signal, outcome);

  tradeStore.updateSignal(signalId, { status: outcome });
  tradeStore.addJournal({
    id: journalId,
    signal_id: signalId,
    entry: signal.entry_price,
    exit: result.exitPrice,
    profit_loss: result.profitLoss,
    r_multiple: result.rMultiple,
    duration: Date.now() - signal.timestamp,
    notes: "",
    created_at: Date.now(),
  });

  return true;
}

export function evaluatePaperTrade(signal: Signal, currentPrice: number): PaperOutcome {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    return "NONE";
  }

  if (signal.status !== "OPEN" && signal.status !== "TP1_HIT") {
    return "NONE";
  }

  const stopPrice = signal.status === "TP1_HIT" ? signal.entry_price : signal.stop_loss;

  if (signal.direction === "LONG") {
    if (currentPrice <= stopPrice) {
      return "STOPPED";
    }

    if (signal.status === "OPEN" && currentPrice >= signal.tp1) {
      return "TP1_HIT";
    }

    if (signal.status === "TP1_HIT" && currentPrice >= signal.tp2) {
      return "TP2_HIT";
    }
  }

  if (signal.direction === "SHORT") {
    if (currentPrice >= stopPrice) {
      return "STOPPED";
    }

    if (signal.status === "OPEN" && currentPrice <= signal.tp1) {
      return "TP1_HIT";
    }

    if (signal.status === "TP1_HIT" && currentPrice <= signal.tp2) {
      return "TP2_HIT";
    }
  }

  return "NONE";
}

export function calculatePaperTradeResult(
  signal: Signal,
  outcome: "TP2_HIT" | "STOPPED",
): PaperTradeResult {
  const directionMultiplier = signal.direction === "LONG" ? 1 : -1;
  const positionSize = signal.position_size;
  const riskAmount = signal.risk_amount;

  const exitPrice =
    outcome === "TP2_HIT"
      ? signal.tp2
      : signal.status === "TP1_HIT"
        ? signal.entry_price
        : signal.stop_loss;

  const firstLegPnl =
    signal.status === "TP1_HIT"
      ? (signal.tp1 - signal.entry_price) * directionMultiplier * positionSize * 0.5
      : 0;

  const finalLegPnl =
    signal.status === "TP1_HIT"
      ? (exitPrice - signal.entry_price) * directionMultiplier * positionSize * 0.5
      : (exitPrice - signal.entry_price) * directionMultiplier * positionSize;

  const profitLoss = firstLegPnl + finalLegPnl;
  const rMultiple = riskAmount > 0 ? profitLoss / riskAmount : 0;

  return {
    exitPrice,
    profitLoss,
    rMultiple,
  };
}
