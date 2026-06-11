"use client";

import { useEffect, useMemo, useState } from "react";
import { formatEther, parseEther } from "viem";
import Toast from "@/components/Toast";
import {
  dayOf,
  demurragedToStatic,
  fetchDemurrageFactors,
  staticToDemurraged,
  type DemurrageFactors,
} from "@/lib/demurrage";

const MIN_DATE = "2020-10-15"; // inflation day zero

type Field = "demurraged" | "static";

// Trim a formatEther string for an input field: at most 8 decimals, no
// trailing zeros, never scientific notation.
function fmtAmount(ether: string): string {
  const [int, frac = ""] = ether.split(".");
  const trimmed = frac.slice(0, 8).replace(/0+$/, "");
  return trimmed ? `${int}.${trimmed}` : int;
}

// Factor display: γ^day / β^day at 6 decimals.
function fmtFactor(atto: bigint): string {
  return Number(formatEther(atto)).toLocaleString(undefined, {
    minimumFractionDigits: 6,
    maximumFractionDigits: 6,
  });
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

// Convert one side to the other at the given day's factors. Null on bad input.
function convert(
  value: string,
  from: Field,
  f: DemurrageFactors,
): string | null {
  let atto: bigint;
  try {
    atto = parseEther(value.trim() || "0");
  } catch {
    return null;
  }
  if (atto < 0n) return null;
  const out =
    from === "demurraged"
      ? demurragedToStatic(atto, f)
      : staticToDemurraged(atto, f);
  return fmtAmount(formatEther(out));
}

export default function ConverterPage() {
  const [dateStr, setDateStr] = useState(todayUTC);
  const [factors, setFactors] = useState<DemurrageFactors | null>(null);
  // Only the side the user last typed into is state; the other side is derived
  // at render time, so a factor refresh re-converts automatically.
  // One day of UBI as the initial example amount.
  const [amount, setAmount] = useState("24");
  const [edited, setEdited] = useState<Field>("demurraged");
  const [error, setError] = useState<string | null>(null);

  // Noon UTC keeps the day index stable across local timezones.
  const targetDay = useMemo(() => {
    const ts = Date.parse(`${dateStr}T12:00:00Z`);
    return Number.isNaN(ts) ? null : Math.max(0, dayOf(ts / 1000));
  }, [dateStr]);

  // Fetch the chosen day's factors; stale ones stay usable until these arrive.
  useEffect(() => {
    if (targetDay === null) return;
    let active = true;
    fetchDemurrageFactors(targetDay)
      .then((f) => {
        if (active) setFactors(f);
      })
      .catch(() => {
        if (active) setError("Could not fetch conversion factors from chain.");
      });
    return () => {
      active = false;
    };
  }, [targetDay]);

  const counterpart = factors ? (convert(amount, edited, factors) ?? "") : "";
  const demurraged = edited === "demurraged" ? amount : counterpart;
  const staticAmt = edited === "static" ? amount : counterpart;

  function onEdit(field: Field, value: string) {
    setEdited(field);
    setAmount(value);
  }

  const hours = Number(demurraged);
  const showTime = Number.isFinite(hours) && hours > 0;
  const loading = factors === null;
  const refreshing = !loading && factors.day !== targetDay;

  const inputClass =
    "mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-sm text-white outline-none focus:border-green-600 disabled:opacity-50";

  return (
    <main className="flex-1 px-4 py-8">
      <div className="mx-auto max-w-md">
        <h1 className="text-2xl font-bold text-white">CRC Converter</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Convert between demurraged CRC (what wallets show) and static CRC
          (inflationary ERC20 units), exactly as the Hub computes them.
        </p>

        <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
          <label className="block text-xs uppercase tracking-wide text-neutral-500">
            Demurraged CRC
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={demurraged}
            onChange={(e) => onEdit("demurraged", e.target.value)}
            disabled={loading}
            placeholder="0.0"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-neutral-500">
            The balance your wallet displays. 1 CRC = 1 hour of UBI, always.
          </p>

          <label className="mt-5 block text-xs uppercase tracking-wide text-neutral-500">
            Static CRC (inflationary)
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={staticAmt}
            onChange={(e) => onEdit("static", e.target.value)}
            disabled={loading}
            placeholder="0.0"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-neutral-500">
            Fixed unit count used by inflationary ERC20 wrappers; each unit
            redeems for less CRC every day.
          </p>

          {showTime && (
            <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-sm text-neutral-300">
              <span className="font-semibold text-white">
                {hours.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
                CRC
              </span>{" "}
              is {hours.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
              hours —{" "}
              {(hours / 24).toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}{" "}
              day{hours / 24 === 1 ? "" : "s"} of one person&apos;s UBI.
            </div>
          )}

          <label className="mt-5 block text-xs uppercase tracking-wide text-neutral-500">
            As of date
          </label>
          <input
            type="date"
            value={dateStr}
            min={MIN_DATE}
            onChange={(e) => setDateStr(e.target.value)}
            className={inputClass}
          />

          <div className="mt-4 text-xs text-neutral-500">
            {loading || refreshing ? (
              "Fetching factors from the Hub…"
            ) : (
              <>
                Day {factors.day} since 15 Oct 2020 · 1 static ={" "}
                <span className="font-mono text-neutral-300">
                  {fmtFactor(factors.toDemurraged)}
                </span>{" "}
                CRC · 1 CRC ={" "}
                <span className="font-mono text-neutral-300">
                  {fmtFactor(factors.toStatic)}
                </span>{" "}
                static
              </>
            )}
          </div>
        </div>

        <p className="mt-4 text-xs text-neutral-500">
          Demurrage runs at 7% per year. Static wrappers don&apos;t escape it:
          the unit count stays fixed while each unit&apos;s CRC value decays —
          both columns above are the same purchasing power, written two ways.
        </p>
      </div>

      {error && <Toast message={error} onDone={() => setError(null)} />}
    </main>
  );
}
