import type { Signal } from "@/lib/types";

export type PaperOutcome = "NONE" | "TP1_HIT" | "TP2_HIT" | "STOPPED";

export function evaluatePaperTrade(
  signal: Signal,
  currentPrice: number,
): PaperOutcome {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    return "NONE";
  }

  if (signal.status !== "OPEN" && signal.status !== "TP1_HIT") {
    return "NONE";
  }

  const stopPrice =
    signal.status === "TP1_HIT"
      ? signal.entry_price
      : signal.stop_loss;

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
