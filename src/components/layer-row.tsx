import { Check, X, AlertTriangle, Minus } from "lucide-react";
import type { LayerResult } from "@/lib/types";

const TONE: Record<LayerResult["status"], { color: string; Icon: typeof Check }> = {
  PASS: { color: "var(--color-bull)", Icon: Check },
  FAIL: { color: "var(--color-bear)", Icon: X },
  WARN: { color: "var(--color-warn)", Icon: AlertTriangle },
  NEUTRAL: { color: "var(--color-neutral)", Icon: Minus },
};

export function LayerRow({ layer }: { layer: LayerResult }) {
  const { color, Icon } = TONE[layer.status];
  return (
    <div className="flex items-start gap-3 border-b border-border py-2.5 last:border-b-0">
      <span
        className="grid size-7 place-items-center rounded-md"
        style={{ background: `${color}22`, color }}
      >
        <Icon className="size-4" />
      </span>
      <div className="flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-sm font-semibold">{layer.name}</div>
          <div
            className="text-[10px] font-bold uppercase tracking-wider"
            style={{ color }}
          >
            {layer.status === "PASS"
              ? "OK"
              : layer.status === "FAIL"
                ? "Fail"
                : layer.status === "WARN"
                  ? "Warn"
                  : "—"}
          </div>
        </div>
        <div className="text-xs text-muted-foreground">{layer.detail}</div>
      </div>
    </div>
  );
}