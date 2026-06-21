export function ScoreGauge({
  score,
  decision,
  direction,
}: {
  score: number;
  decision: "NO_TRADE" | "SIGNAL" | "STRONG_SIGNAL";
  direction: "LONG" | "SHORT" | "NONE";
}) {
  const tone =
    decision === "NO_TRADE"
      ? "var(--color-neutral)"
      : direction === "LONG"
        ? "var(--color-bull)"
        : direction === "SHORT"
          ? "var(--color-bear)"
          : "var(--color-warn)";
  const label =
    decision === "STRONG_SIGNAL"
      ? "STARKES SIGNAL"
      : decision === "SIGNAL"
        ? "SIGNAL"
        : "KEIN TRADE";
  const dirLabel =
    direction === "LONG" ? "LONG" : direction === "SHORT" ? "SHORT" : "—";
  const r = 64;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score));
  const dash = (pct / 100) * circ;
  return (
    <div className="tile relative flex items-center gap-4 p-4">
      <svg width="160" height="160" viewBox="0 0 160 160" className="shrink-0">
        <circle
          cx="80"
          cy="80"
          r={r}
          stroke="var(--color-border)"
          strokeWidth="10"
          fill="none"
        />
        <circle
          cx="80"
          cy="80"
          r={r}
          stroke={tone}
          strokeWidth="10"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          transform="rotate(-90 80 80)"
          style={{ transition: "stroke-dasharray .6s ease, stroke .3s" }}
        />
        <text
          x="80"
          y="76"
          textAnchor="middle"
          className="num"
          fontSize="34"
          fontWeight={700}
          fill="var(--color-foreground)"
        >
          {Math.round(score)}
        </text>
        <text
          x="80"
          y="98"
          textAnchor="middle"
          fontSize="11"
          fill="var(--color-muted-foreground)"
        >
          / 100
        </text>
      </svg>
      <div className="flex flex-col gap-1">
        <span
          className="inline-flex w-fit rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider"
          style={{ background: `${tone}22`, color: tone }}
        >
          {label}
        </span>
        <div className="text-2xl font-bold">{dirLabel}</div>
        <div className="text-xs text-muted-foreground">
          Default-Regel:&nbsp;
          <span className="text-foreground">NO TRADE</span> bei Unsicherheit.
        </div>
      </div>
    </div>
  );
}