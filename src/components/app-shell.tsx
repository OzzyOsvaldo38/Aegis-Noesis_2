import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  BookOpen,
  History,
  LineChart,
  Settings,
} from "lucide-react";
import type { ReactNode } from "react";

const NAV = [
  { to: "/" as const, label: "Live", icon: Activity },
  { to: "/signal" as const, label: "Signal", icon: LineChart },
  { to: "/journal" as const, label: "Journal", icon: BookOpen },
  { to: "/analytics" as const, label: "Analyse", icon: BarChart3 },
  { to: "/backtest" as const, label: "Backtest", icon: History },
  { to: "/einstellungen" as const, label: "Settings", icon: Settings },
];

export function AppShell({
  children,
  title,
  right,
}: {
  children: ReactNode;
  title: string;
  right?: ReactNode;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-md bg-primary/15 text-primary">
              <Activity className="size-4" />
            </span>
            <div className="leading-tight">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                BTC Engine
              </div>
              <div className="text-sm font-semibold">{title}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">{right}</div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-4">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur">
        <ul className="mx-auto flex max-w-3xl items-stretch justify-between px-1 py-1.5">
          {NAV.map(({ to, label, icon: Icon }) => {
            const active = pathname === to || (to !== "/" && pathname.startsWith(to));
            return (
              <li key={to} className="flex-1">
                <Link
                  to={to}
                  className={
                    "flex flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-[10px] font-medium transition-colors " +
                    (active
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground")
                  }
                >
                  <Icon className="size-[18px]" />
                  <span>{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}