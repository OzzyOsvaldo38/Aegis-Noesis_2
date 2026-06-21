// Tiny localStorage helpers for user settings, signals, journal, analytics.
// All schemas live in ./types.

import type {
  AnalyticsRow,
  JournalEntry,
  Signal,
  User,
} from "./types";

const KEY_USER = "btc_engine.user";
const KEY_SIGNALS = "btc_engine.signals";
const KEY_JOURNAL = "btc_engine.journal";
const KEY_ANALYTICS = "btc_engine.analytics";
const KEY_SETTINGS = "btc_engine.settings";

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota errors
  }
}

export const defaultUser: User = {
  id: "local",
  email: "local@device",
  created_at: Date.now(),
  plan: "free",
  account_size: 100,
  risk_per_trade: 1,
  daily_risk_limit: 2,
  weekly_risk_limit: 5,
  default_leverage: 10,
};

export interface AppSettings {
  symbol: string;
  pollMs: number;
  notifyEnabled: boolean;
  minScore: number;
}

export const defaultSettings: AppSettings = {
  symbol: "BTCUSDT",
  pollMs: 15000,
  notifyEnabled: false,
  minScore: 80,
};

export const store = {
  getUser: (): User => readJSON(KEY_USER, defaultUser),
  setUser: (u: User) => writeJSON(KEY_USER, u),

  getSettings: (): AppSettings => ({
    ...defaultSettings,
    ...readJSON<Partial<AppSettings>>(KEY_SETTINGS, {}),
  }),
  setSettings: (s: AppSettings) => writeJSON(KEY_SETTINGS, s),

  getSignals: (): Signal[] => readJSON<Signal[]>(KEY_SIGNALS, []),
  setSignals: (list: Signal[]) => writeJSON(KEY_SIGNALS, list),
  addSignal: (s: Signal) => {
    const list = store.getSignals();
    list.unshift(s);
    writeJSON(KEY_SIGNALS, list.slice(0, 500));
  },
  updateSignal: (id: string, patch: Partial<Signal>) => {
    const list = store.getSignals().map((s) =>
      s.id === id ? { ...s, ...patch } : s,
    );
    writeJSON(KEY_SIGNALS, list);
  },

  getJournal: (): JournalEntry[] => readJSON<JournalEntry[]>(KEY_JOURNAL, []),
  addJournal: (j: JournalEntry) => {
    const list = store.getJournal();
    list.unshift(j);
    writeJSON(KEY_JOURNAL, list);
  },
  setJournal: (list: JournalEntry[]) => writeJSON(KEY_JOURNAL, list),

  getAnalytics: (): AnalyticsRow[] =>
    readJSON<AnalyticsRow[]>(KEY_ANALYTICS, []),
  setAnalytics: (list: AnalyticsRow[]) => writeJSON(KEY_ANALYTICS, list),
};

export function uid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}