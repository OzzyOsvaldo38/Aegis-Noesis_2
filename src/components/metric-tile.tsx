import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function MetricTile({
  label,
  value,
  hint,
  tone = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "bull" | "bear" | "warn" | "neutral";
  className?: string;
}) {
  const toneClass =
    tone === "bull"
      ? "text-[var(--color-bull)]"
      : tone === "bear"
        ? "text-[var(--color-bear)]"
        : tone === "warn"
          ? "text-[var(--color-warn)]"
          : tone === "neutral"
            ? "text-muted-foreground"
            : "text-foreground";
  return (
    <div className={cn("tile p-3", className)}>
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={cn("num mt-1 text-base font-semibold", toneClass)}>
        {value}
      </div>
      {hint ? (
        <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}