import { formatEther } from "viem";

// Shared display helpers (every tool page shows CRC amounts and addresses).

// Trim a CRC value for display without scientific notation or a wall of dust.
export function fmtCrc(atto: bigint, maxFractionDigits = 2): string {
  const n = Number(formatEther(atto));
  return n.toLocaleString(undefined, {
    maximumFractionDigits: maxFractionDigits,
  });
}

export function shorten(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

// "3d 4h" / "5h 12m" / "now" — for accrual countdowns and staleness labels.
export function fmtDuration(seconds: number): string {
  if (seconds <= 0) return "now";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function fmtDate(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
