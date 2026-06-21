import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ensureNotificationPermission } from "@/lib/notifications";
import { defaultSettings, defaultUser, store } from "@/lib/storage";
import type { AppSettings } from "@/lib/storage";
import type { User } from "@/lib/types";

export const Route = createFileRoute("/einstellungen")({
  head: () => ({
    meta: [
      { title: "Einstellungen — BTC Engine" },
      { name: "description", content: "Konto-Größe, Risiko, Hebel und Benachrichtigungen." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const [user, setUser] = useState<User>(defaultUser);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setUser(store.getUser());
    setSettings(store.getSettings());
  }, []);

  const save = async () => {
    if (settings.notifyEnabled) {
      const granted = await ensureNotificationPermission();
      if (!granted) {
        alert("Browser-Benachrichtigungen wurden nicht erlaubt.");
        setSettings({ ...settings, notifyEnabled: false });
        return;
      }
    }
    store.setUser(user);
    store.setSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const wipe = () => {
    if (!confirm("Alle Signale, Journal & Analyse löschen?")) return;
    store.setSignals([]);
    store.setJournal([]);
    store.setAnalytics([]);
    alert("Daten gelöscht.");
  };

  return (
    <AppShell title="Einstellungen">
      <div className="space-y-3">
        <Section title="Risk Management">
          <Field label="Konto-Größe (USDT)">
            <NumberInput
              value={user.account_size}
              onChange={(v) => setUser({ ...user, account_size: v })}
            />
          </Field>
          <Field label="Risk pro Trade (%)">
            <NumberInput
              step={0.1}
              value={user.risk_per_trade}
              onChange={(v) => setUser({ ...user, risk_per_trade: v })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Tageslimit (%)">
              <NumberInput
                step={0.5}
                value={user.daily_risk_limit}
                onChange={(v) => setUser({ ...user, daily_risk_limit: v })}
              />
            </Field>
            <Field label="Wochenlimit (%)">
              <NumberInput
                step={0.5}
                value={user.weekly_risk_limit}
                onChange={(v) => setUser({ ...user, weekly_risk_limit: v })}
              />
            </Field>
          </div>
          <Field label="Standard-Hebel (5–20×)">
            <input
              type="range"
              min={5}
              max={20}
              value={user.default_leverage}
              onChange={(e) =>
                setUser({ ...user, default_leverage: Number(e.target.value) })
              }
              className="w-full"
            />
            <div className="num mt-1 text-sm font-semibold">
              {user.default_leverage}×
            </div>
          </Field>
        </Section>

        <Section title="Engine">
          <Field label="Symbol">
            <select
              value={settings.symbol}
              onChange={(e) => setSettings({ ...settings, symbol: e.target.value })}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            >
              <option value="BTCUSDT">BTCUSDT</option>
              <option value="ETHUSDT">ETHUSDT</option>
              <option value="SOLUSDT">SOLUSDT</option>
            </select>
          </Field>
          <Field label="Update-Intervall (Sek.)">
            <NumberInput
              step={5}
              value={settings.pollMs / 1000}
              onChange={(v) =>
                setSettings({ ...settings, pollMs: Math.max(10, v) * 1000 })
              }
            />
          </Field>
          <Field label="Mindest-Score für Signal">
            <NumberInput
              value={settings.minScore}
              onChange={(v) =>
                setSettings({ ...settings, minScore: Math.max(50, Math.min(100, v)) })
              }
            />
          </Field>
          <Field label="Browser-Push aktivieren">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.notifyEnabled}
                onChange={(e) =>
                  setSettings({ ...settings, notifyEnabled: e.target.checked })
                }
              />
              Benachrichtigung bei Score ≥ Mindest-Score
            </label>
          </Field>
        </Section>

        <button
          onClick={save}
          className="w-full rounded-md bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          {saved ? "Gespeichert ✓" : "Speichern"}
        </button>

        <button
          onClick={wipe}
          className="w-full rounded-md border border-[var(--color-bear)]/40 py-2.5 text-sm font-semibold text-[var(--color-bear)] hover:bg-[var(--color-bear)]/10"
        >
          Alle lokalen Daten löschen
        </button>

        <div className="tile p-3 text-[11px] text-muted-foreground">
          Alle Daten werden ausschließlich lokal in deinem Browser gespeichert
          (localStorage). Es gibt kein Backend, keinen Login, keinen Datenversand.
          Default-Regel der Engine:{" "}
          <span className="text-foreground font-semibold">NO TRADE</span>.
        </div>
      </div>
    </AppShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="tile p-3">
      <div className="px-1 pb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function NumberInput({
  value,
  onChange,
  step = 1,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <input
      type="number"
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="num w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
    />
  );
}