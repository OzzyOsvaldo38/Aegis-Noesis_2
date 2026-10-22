import assert from "node:assert/strict";
import test from "node:test";
import type { JournalEntry, Signal } from "./types.ts";
import { calculatePaperTradeResult, closePaperTrade, evaluatePaperTrade } from "./paper-trade.ts";

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: "signal-1",
    timestamp: 0,
    symbol: "BTCUSDT",
    direction: "LONG",
    entry_price: 100,
    stop_loss: 90,
    tp1: 110,
    tp2: 120,
    signal_score: 0,
    liquidity_risk_score: 0,
    trend_status: "",
    structure_status: "",
    funding_rate: 0,
    open_interest: 0,
    risk_amount: 100,
    position_size: 10,
    leverage: 1,
    status: "OPEN",
    ...overrides,
  };
}

function makeTradeStore(initialSignal: Signal) {
  const signals = [initialSignal];
  const journal: JournalEntry[] = [];

  return {
    getSignals: () => signals,
    getJournal: () => journal,
    updateSignal: (id: string, patch: Partial<Signal>) => {
      const index = signals.findIndex((signal) => signal.id === id);
      if (index !== -1) {
        signals[index] = { ...signals[index], ...patch };
      }
    },
    addJournal: (entry: JournalEntry) => {
      journal.unshift(entry);
    },
  };
}

test("paper-trade thresholds preserve TP1, TP2, and stop rules", () => {
  const long = makeSignal();
  const short = makeSignal({
    direction: "SHORT",
    stop_loss: 110,
    tp1: 90,
    tp2: 80,
  });

  assert.equal(evaluatePaperTrade(long, 110), "TP1_HIT");
  assert.equal(evaluatePaperTrade(long, 90), "STOPPED");
  assert.equal(evaluatePaperTrade({ ...long, status: "TP1_HIT" }, 120), "TP2_HIT");
  assert.equal(evaluatePaperTrade(short, 90), "TP1_HIT");
  assert.equal(evaluatePaperTrade(short, 110), "STOPPED");
  assert.equal(evaluatePaperTrade({ ...short, status: "TP1_HIT" }, 80), "TP2_HIT");
});

test("an open trade books full position PnL at TP2 or stop-loss", () => {
  const signal = makeSignal();

  assert.deepEqual(calculatePaperTradeResult(signal, "TP2_HIT"), {
    exitPrice: 120,
    profitLoss: 200,
    rMultiple: 2,
  });
  assert.deepEqual(calculatePaperTradeResult(signal, "STOPPED"), {
    exitPrice: 90,
    profitLoss: -100,
    rMultiple: -1,
  });
});

test("after TP1, books half at TP1 and exits the remainder at TP2", () => {
  const signal = makeSignal({ status: "TP1_HIT" });

  assert.deepEqual(calculatePaperTradeResult(signal, "TP2_HIT"), {
    exitPrice: 120,
    profitLoss: 150,
    rMultiple: 1.5,
  });
});

test("after TP1, stop-loss exits the remainder at break-even", () => {
  const signal = makeSignal({ status: "TP1_HIT" });

  assert.deepEqual(calculatePaperTradeResult(signal, "STOPPED"), {
    exitPrice: 100,
    profitLoss: 50,
    rMultiple: 0.5,
  });
});

test("partial-exit calculation mirrors for short trades", () => {
  const signal = makeSignal({
    direction: "SHORT",
    stop_loss: 110,
    tp1: 90,
    tp2: 80,
    status: "TP1_HIT",
  });

  assert.deepEqual(calculatePaperTradeResult(signal, "TP2_HIT"), {
    exitPrice: 80,
    profitLoss: 150,
    rMultiple: 1.5,
  });
  assert.deepEqual(calculatePaperTradeResult(signal, "STOPPED"), {
    exitPrice: 100,
    profitLoss: 50,
    rMultiple: 0.5,
  });
});

test("returns zero R when configured risk amount is zero", () => {
  assert.equal(calculatePaperTradeResult(makeSignal({ risk_amount: 0 }), "TP2_HIT").rMultiple, 0);
});

test("repeated manual closure creates only one journal entry", () => {
  const tradeStore = makeTradeStore(makeSignal());

  assert.equal(closePaperTrade(tradeStore, "signal-1", "TP2_HIT", "journal-1"), true);
  assert.equal(closePaperTrade(tradeStore, "signal-1", "STOPPED", "journal-2"), false);
  assert.equal(tradeStore.getJournal().length, 1);
  assert.equal(tradeStore.getSignals()[0].status, "TP2_HIT");
});

test("automatic and manual closures cannot create duplicate journal entries", () => {
  const tradeStore = makeTradeStore(makeSignal({ status: "TP1_HIT" }));

  assert.equal(closePaperTrade(tradeStore, "signal-1", "TP2_HIT", "automatic-journal"), true);
  assert.equal(closePaperTrade(tradeStore, "signal-1", "TP2_HIT", "manual-journal"), false);
  assert.equal(tradeStore.getJournal().length, 1);
  const expectedResult = calculatePaperTradeResult(makeSignal({ status: "TP1_HIT" }), "TP2_HIT");
  assert.deepEqual(
    {
      exitPrice: tradeStore.getJournal()[0].exit,
      profitLoss: tradeStore.getJournal()[0].profit_loss,
      rMultiple: tradeStore.getJournal()[0].r_multiple,
    },
    expectedResult,
  );
});

test("closure rejects invalid signal states and existing journal entries", () => {
  const cancelledStore = makeTradeStore(makeSignal({ status: "CANCELLED" }));
  const journaledStore = makeTradeStore(makeSignal());
  journaledStore.getJournal().push({
    id: "journal-1",
    signal_id: "signal-1",
    entry: 100,
    exit: 120,
    profit_loss: 200,
    r_multiple: 2,
    duration: 0,
    notes: "",
    created_at: 0,
  });

  assert.equal(closePaperTrade(cancelledStore, "signal-1", "TP2_HIT", "journal-1"), false);
  assert.equal(closePaperTrade(journaledStore, "signal-1", "STOPPED", "journal-2"), false);
  assert.equal(cancelledStore.getJournal().length, 0);
  assert.equal(journaledStore.getJournal().length, 1);
});
