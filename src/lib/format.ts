export const fmtUSD = (n: number, digits = 2) =>
  n.toLocaleString("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

export const fmtPrice = (n: number) =>
  n.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const fmtPct = (n: number, digits = 2) =>
  `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;

export const fmtCompact = (n: number) =>
  Intl.NumberFormat("de-DE", { notation: "compact", maximumFractionDigits: 2 })
    .format(n);

export const fmtTime = (ts: number) =>
  new Date(ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export const fmtDate = (ts: number) =>
  new Date(ts).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });