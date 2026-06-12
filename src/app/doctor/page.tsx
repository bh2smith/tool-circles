"use client";

import { useEffect, useState } from "react";
import { formatEther, parseEther } from "viem";
import Toast from "@/components/Toast";
import Avatar from "@/components/Avatar";
import AddressField from "@/components/AddressField";
import {
  circlesProfileUrl,
  fetchCirclesProfiles,
  initCircles,
  resolveAddress,
  subscribeWallet,
} from "@/lib/circles";
import { diagnoseCorridor, type CorridorDiagnosis } from "@/lib/doctor";

// Probe far above any real balance so the pathfinder returns the true max flow
// of the corridor, not just "enough for the requested amount".
const MAX_PROBE = parseEther("100000000000");

// Past this many "locked out" rows, summarise instead of listing.
const MAX_ROWS = 15;

function shorten(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function fmtCrc(atto: bigint): string {
  const n = Number(formatEther(atto));
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function pct(part: bigint, whole: bigint): string {
  if (whole === 0n) return "0";
  return (Number((part * 10000n) / whole) / 100).toFixed(1);
}

interface NamedParty {
  address: string;
  name: string | null;
  image: string | null;
}

interface Result {
  from: NamedParty;
  to: NamedParty;
  requested: bigint | null;
  diagnosis: CorridorDiagnosis;
  lockedOut: NamedParty[]; // top notAccepted owners, with profiles
}

export default function DoctorPage() {
  const [avatar, setAvatar] = useState<string | null>(null);
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");
  const [amount, setAmount] = useState("");
  const [diagnosing, setDiagnosing] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read-only tool: the wallet (when present) only prefills the sender field.
  useEffect(() => {
    initCircles();
    return subscribeWallet((addr) => {
      setAvatar(addr);
      if (addr) setFromInput((prev) => (prev === "" ? addr : prev));
    });
  }, []);

  async function onDiagnose() {
    setError(null);
    setResult(null);
    setDiagnosing(true);
    try {
      const [from, to] = await Promise.all([
        resolveAddress(fromInput),
        resolveAddress(toInput),
      ]);
      if (!from) throw new Error("Could not resolve the sender.");
      if (!to) throw new Error("Could not resolve the recipient.");
      if (from.toLowerCase() === to.toLowerCase())
        throw new Error(
          "Sender and recipient are the same — use Replenish for self-routing.",
        );
      let requested: bigint | null = null;
      const amt = amount.trim();
      if (amt) {
        try {
          requested = parseEther(amt);
        } catch {
          throw new Error("Enter a valid CRC amount (or leave it empty).");
        }
        if (requested <= 0n) requested = null;
      }

      const diagnosis = await diagnoseCorridor(from, to, MAX_PROBE);
      const owners = diagnosis.notAccepted
        .slice(0, MAX_ROWS)
        .map((h) => h.owner);
      const profiles = await fetchCirclesProfiles([from, to, ...owners]);
      const named = (address: string): NamedParty => {
        const p = profiles.get(address.toLowerCase());
        return {
          address: address.toLowerCase(),
          name: p?.name ?? null,
          image: p?.previewImageUrl ?? null,
        };
      };
      setResult({
        from: named(from),
        to: named(to),
        requested,
        diagnosis,
        lockedOut: owners.map(named),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "diagnosis failed");
    } finally {
      setDiagnosing(false);
    }
  }

  const d = result?.diagnosis ?? null;
  const toLabel = result
    ? (result.to.name ?? shorten(result.to.address))
    : null;
  const canPay =
    d && result?.requested != null ? d.maxFlow >= result.requested : null;
  const lockedTotal = d ? d.notAccepted.reduce((s, h) => s + h.atto, 0n) : 0n;

  const inputClass =
    "mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-sm text-white outline-none focus:border-green-600 disabled:opacity-50";
  const labelClass =
    "mt-4 block text-xs uppercase tracking-wide text-neutral-500 first:mt-0";

  return (
    <main className="flex-1 px-4 py-8">
      <div className="mx-auto max-w-md">
        <h1 className="text-2xl font-bold text-white">Payment Doctor</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Diagnose a CRC payment: how much can actually route from sender to
          recipient, and which trusts would widen the corridor.
        </p>

        {/* ── Inputs ────────────────────────────────────────────────── */}
        <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
          <AddressField
            label="From (sender)"
            value={fromInput}
            onChange={setFromInput}
            avatar={avatar}
          />

          <AddressField
            label="To (recipient)"
            value={toInput}
            onChange={setToInput}
            onEnter={onDiagnose}
            className="mt-4"
          />

          <label className={labelClass}>Amount (CRC, optional)</label>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onDiagnose()}
            placeholder="leave empty for max-flow only"
            className={inputClass}
          />

          <button
            onClick={onDiagnose}
            disabled={diagnosing}
            className="mt-4 w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-500 disabled:opacity-50"
          >
            {diagnosing ? "Probing the trust graph…" : "Diagnose"}
          </button>
        </div>

        {/* ── Verdict ───────────────────────────────────────────────── */}
        {result && d && (
          <>
            <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
              {result.requested != null && (
                <div
                  className={`rounded-lg border p-3 text-sm ${
                    canPay
                      ? "border-green-800 bg-green-950/40 text-green-300"
                      : "border-red-800 bg-red-950/40 text-red-300"
                  }`}
                >
                  {canPay ? (
                    <>
                      <span className="font-semibold">
                        {fmtCrc(result.requested)} CRC can route
                      </span>{" "}
                      to {toLabel}.
                    </>
                  ) : (
                    <>
                      Only{" "}
                      <span className="font-semibold">
                        {fmtCrc(d.maxFlow)} of {fmtCrc(result.requested)} CRC
                      </span>{" "}
                      ({pct(d.maxFlow, result.requested)}%) can route to{" "}
                      {toLabel}.
                    </>
                  )}
                </div>
              )}

              <div className="mt-4 text-xs uppercase tracking-wide text-neutral-500">
                Max transferable right now
              </div>
              <div className="mt-1 text-2xl font-semibold text-white">
                {fmtCrc(d.maxFlow)} CRC
              </div>
              <div className="mt-1 text-xs text-neutral-500">
                via {d.transferEdges} transfer edge
                {d.transferEdges === 1 ? "" : "s"} · you hold{" "}
                {fmtCrc(d.totalHeld)} CRC total, so{" "}
                {pct(d.maxFlow, d.totalHeld)}% of it can reach {toLabel}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs">
                <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-2">
                  <div className="text-base font-semibold text-green-400">
                    {fmtCrc(d.acceptedHeld)}
                  </div>
                  <div className="text-neutral-500">
                    CRC accepted directly ({d.acceptedCount} token
                    {d.acceptedCount === 1 ? "" : "s"})
                  </div>
                </div>
                <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-2">
                  <div className="text-base font-semibold text-yellow-400">
                    {fmtCrc(lockedTotal)}
                  </div>
                  <div className="text-neutral-500">
                    CRC in tokens {toLabel} doesn&apos;t trust
                  </div>
                </div>
              </div>
            </div>

            {/* ── Widen the corridor ────────────────────────────────── */}
            {(d.notAccepted.length > 0 || !d.senderTokenAccepted) && (
              <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
                <h2 className="text-lg font-semibold text-white">
                  Widen the corridor
                </h2>
                <p className="mt-1 text-sm text-neutral-400">
                  Tokens below can still route through intermediaries when
                  there&apos;s liquidity, but every direct trust from {toLabel}{" "}
                  is a guaranteed unlock — up to the amount held.
                </p>

                {!d.senderTokenAccepted && (
                  <div className="mt-3 rounded-lg border border-yellow-800 bg-yellow-950/30 p-3 text-sm text-yellow-300">
                    {toLabel} doesn&apos;t trust the sender directly, so the
                    sender&apos;s own{" "}
                    <span className="font-semibold">
                      {fmtCrc(d.senderOwnHeld)} CRC
                    </span>{" "}
                    must route via intermediaries. A direct trust is the single
                    biggest unlock.
                  </div>
                )}

                {result.lockedOut.length > 0 && (
                  <div className="mt-3 max-h-80 space-y-1 overflow-y-auto">
                    {result.lockedOut.map((p, i) => (
                      <a
                        key={p.address}
                        href={circlesProfileUrl(p.address)}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-950 p-2 transition-colors hover:border-neutral-600"
                      >
                        <span className="w-4 shrink-0 text-right text-xs text-neutral-600">
                          {i + 1}
                        </span>
                        <Avatar src={p.image} alt={p.name ?? p.address} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-neutral-200">
                            {p.name ?? shorten(p.address)}
                            {p.address === result.from.address && (
                              <span className="ml-2 rounded bg-yellow-900/60 px-1.5 py-0.5 text-[10px] font-semibold text-yellow-300">
                                sender
                              </span>
                            )}
                          </div>
                          <div className="font-mono text-xs text-neutral-500">
                            {shorten(p.address)}
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-xs text-neutral-400">
                          {fmtCrc(d.notAccepted[i]?.atto ?? 0n)} CRC
                        </div>
                      </a>
                    ))}
                  </div>
                )}

                {d.notAccepted.length > MAX_ROWS && (
                  <p className="mt-2 text-xs text-neutral-500">
                    …and {d.notAccepted.length - MAX_ROWS} more token
                    {d.notAccepted.length - MAX_ROWS === 1
                      ? ""
                      : "s"} worth{" "}
                    {fmtCrc(
                      d.notAccepted
                        .slice(MAX_ROWS)
                        .reduce((s, h) => s + h.atto, 0n),
                    )}{" "}
                    CRC.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {error && <Toast message={error} onDone={() => setError(null)} />}
    </main>
  );
}
