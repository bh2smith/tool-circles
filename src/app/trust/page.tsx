"use client";

import { useEffect, useState } from "react";
import Toast from "@/components/Toast";
import {
  CIRCLES_MINIAPP_URL,
  fetchCirclesProfiles,
  initCircles,
  isMiniappMode,
  resolveAddress,
  sendTransactions,
  subscribeWallet,
} from "@/lib/circles";
import { HUB_ADDRESS } from "@/lib/contract";
import {
  type AskCandidate,
  encodeUntrust,
  fetchAskCandidates,
  fetchOutgoingTrusts,
  fetchTrustScore,
  fetchTrustScores,
  HOP_DECAY,
  type TrustScore,
} from "@/lib/trust";

function shorten(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

// Qualitative band for a 0..100 Backers score, used for colour + label.
function band(score: number): { label: string; color: string } {
  if (score >= 70) return { label: "Strong", color: "text-green-400" };
  if (score >= 40) return { label: "Moderate", color: "text-lime-400" };
  if (score >= 10) return { label: "Weak", color: "text-yellow-400" };
  return { label: "Minimal", color: "text-red-400" };
}

interface TrusteeRow {
  address: string;
  name: string | null;
  score: number | null; // null if the analytics API returned no row
}

export default function TrustPage() {
  const [ready, setReady] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Evaluator state
  const [input, setInput] = useState("");
  const [evaluating, setEvaluating] = useState(false);
  const [score, setScore] = useState<TrustScore | null>(null);
  const [scoredName, setScoredName] = useState<string | null>(null);

  // Untrust-manager state
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [rows, setRows] = useState<TrusteeRow[]>([]);
  const [threshold, setThreshold] = useState(10);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [untrusting, setUntrusting] = useState(false);
  const [untrustHashes, setUntrustHashes] = useState<string[] | null>(null);

  // "Who to ask" state
  const [askLoading, setAskLoading] = useState(false);
  const [asks, setAsks] = useState<{
    candidates: AskCandidate[];
    names: Map<string, string | null>;
    hop1: number;
    hop2: number;
    total: number;
    truncated: boolean;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    initCircles();
    return subscribeWallet((addr) => {
      setAvatar(addr);
      setReady(true);
    });
  }, []);

  async function onEvaluate(raw?: string) {
    const query = (raw ?? input).trim();
    setError(null);
    setScore(null);
    setScoredName(null);
    if (!query) {
      setError("Enter an address or username.");
      return;
    }
    setEvaluating(true);
    try {
      const addr = await resolveAddress(query);
      if (!addr) throw new Error("Could not resolve that address or username.");
      const [s, profiles] = await Promise.all([
        fetchTrustScore(addr),
        fetchCirclesProfiles([addr]),
      ]);
      setScore(s);
      setScoredName(profiles.get(addr.toLowerCase())?.name ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "evaluation failed");
    } finally {
      setEvaluating(false);
    }
  }

  // Scan the connected avatar's active trust list and score every trustee, so
  // weakly-connected (likely sybil) accounts can be pruned.
  async function onScan() {
    if (!avatar) return;
    setError(null);
    setScanned(false);
    setRows([]);
    setSelected(new Set());
    setUntrustHashes(null);
    setScanning(true);
    try {
      const trustees = await fetchOutgoingTrusts(avatar);
      if (trustees.length === 0) {
        setRows([]);
        setScanned(true);
        return;
      }
      const [scores, profiles] = await Promise.all([
        fetchTrustScores(trustees),
        fetchCirclesProfiles(trustees),
      ]);
      const next: TrusteeRow[] = trustees.map((a) => ({
        address: a,
        name: profiles.get(a)?.name ?? null,
        score: scores.get(a)?.relativeScore ?? null,
      }));
      // Worst first; missing scores treated as 0 (unreachable to backers).
      next.sort((x, y) => (x.score ?? 0) - (y.score ?? 0));
      setRows(next);
      setSelected(
        new Set(
          next.filter((r) => (r.score ?? 0) < threshold).map((r) => r.address),
        ),
      );
      setScanned(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "scan failed");
    } finally {
      setScanning(false);
    }
  }

  function toggle(addr: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(addr)) next.delete(addr);
      else next.add(addr);
      return next;
    });
  }

  function selectBelowThreshold() {
    setSelected(
      new Set(
        rows.filter((r) => (r.score ?? 0) < threshold).map((r) => r.address),
      ),
    );
  }

  async function onUntrust() {
    if (selected.size === 0) return;
    setError(null);
    setUntrustHashes(null);
    setUntrusting(true);
    try {
      const txs = [...selected].map((addr) => ({
        to: HUB_ADDRESS,
        data: encodeUntrust(addr),
        value: "0x0",
      }));
      const hashes = await sendTransactions(txs);
      setUntrustHashes(Array.isArray(hashes) ? hashes : [String(hashes)]);
      // Drop the untrusted rows from the list.
      setRows((prev) => prev.filter((r) => !selected.has(r.address)));
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "untrust failed");
    } finally {
      setUntrusting(false);
    }
  }

  // Find the Backers to ask for a direct trust (hop 2 -> hop 1), ranked warmest
  // first. Works for any looked-up address; defaults to the connected avatar.
  async function onFindAsks(target: string) {
    setError(null);
    setAsks(null);
    setCopied(false);
    setAskLoading(true);
    try {
      const data = await fetchAskCandidates(target);
      const names = await fetchCirclesProfiles(
        data.candidates.map((c) => c.address),
      );
      setAsks({
        candidates: data.candidates,
        names: new Map(
          data.candidates.map((c) => [
            c.address,
            names.get(c.address)?.name ?? null,
          ]),
        ),
        hop1: data.hop1Backers,
        hop2: data.hop2Backers,
        total: data.totalBackers,
        truncated: data.truncated,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not build ask list");
    } finally {
      setAskLoading(false);
    }
  }

  function copyAsks() {
    if (!asks) return;
    const lines = asks.candidates.map((c) => {
      const n = asks.names.get(c.address);
      return `${n ? n + " " : ""}${c.address}  (${c.sharedIntermediaries} mutual${c.youTrust ? ", you trust them" : ""})`;
    });
    navigator.clipboard
      ?.writeText(lines.join("\n"))
      .then(() => setCopied(true))
      .catch(() => setError("clipboard unavailable"));
  }

  if (!ready) return null;

  const connected = isMiniappMode() && !!avatar;
  const b = score ? band(score.relativeScore) : null;
  const hops = score?.hopBreakdown
    ? Object.keys(score.hopBreakdown)
        .map(Number)
        .sort((a, c) => a - c)
    : [];

  return (
    <main className="flex-1 px-4 py-8">
      <div className="mx-auto max-w-md">
        <h1 className="text-2xl font-bold text-white">Trust Score</h1>
        <p className="mt-2 text-sm text-neutral-400">
          The Backers trust score measures how well-connected an account is to
          the Circles <span className="text-neutral-200">Backers</span> group —
          a proxy for trustworthiness and non-sybilhood.
        </p>

        {/* ── Evaluator ─────────────────────────────────────────────── */}
        <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
          <label className="block text-xs uppercase tracking-wide text-neutral-500">
            Address or username
          </label>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onEvaluate()}
            placeholder="0x… or a Circles name"
            className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-sm text-white outline-none focus:border-green-600"
          />
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => onEvaluate()}
              disabled={evaluating}
              className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-500 disabled:opacity-50"
            >
              {evaluating ? "Calculating…" : "Calculate score"}
            </button>
            {connected && (
              <button
                onClick={() => {
                  setInput(avatar!);
                  onEvaluate(avatar!);
                }}
                disabled={evaluating}
                className="rounded-lg border border-neutral-700 px-4 py-2 text-sm font-semibold text-neutral-200 transition-colors hover:border-neutral-500 disabled:opacity-50"
              >
                My score
              </button>
            )}
          </div>

          {score && b && (
            <div className="mt-5 rounded-lg border border-neutral-800 bg-neutral-950 p-4">
              <div className="flex items-end justify-between">
                <div>
                  <div className={`text-4xl font-bold ${b.color}`}>
                    {score.relativeScore.toFixed(1)}
                  </div>
                  <div className="text-xs uppercase tracking-wide text-neutral-500">
                    {b.label} · relative trust score
                  </div>
                </div>
                <div className="text-right text-sm text-neutral-400">
                  <div>
                    {score.targetsReached}/{score.totalTargets} backers
                  </div>
                  <div>{(score.penetrationRate * 100).toFixed(1)}% reached</div>
                </div>
              </div>
              <div className="mt-3 break-all font-mono text-xs text-neutral-500">
                {scoredName ? `${scoredName} · ` : ""}
                {score.address}
              </div>

              {hops.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs uppercase tracking-wide text-neutral-500">
                    Backers reached by hop distance
                  </div>
                  <div className="mt-2 space-y-1">
                    {hops.map((h) => {
                      const count = score.hopBreakdown![String(h)];
                      const pct = (count / score.targetsReached) * 100;
                      return (
                        <div
                          key={h}
                          className="flex items-center gap-2 text-xs"
                        >
                          <span className="w-12 shrink-0 text-neutral-400">
                            hop {h}
                          </span>
                          <div className="h-2 flex-1 overflow-hidden rounded bg-neutral-800">
                            <div
                              className="h-full bg-green-600"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="w-20 shrink-0 text-right text-neutral-400">
                            {count} ×{HOP_DECAY[h] ?? "—"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Who to ask to trust you ───────────────────────────────── */}
        {score && (
          <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
            <h2 className="text-lg font-semibold text-white">
              Who to ask to trust you
            </h2>
            <p className="mt-1 text-sm text-neutral-400">
              The only way to raise this score is to get Backers to trust you
              directly. These Backers already reach you at hop 2 (through a
              mutual connection) but don&apos;t trust you yet — the warmest,
              highest- leverage asks. A direct trust from any of them moves it
              from hop 2 to hop 1.
            </p>

            <button
              onClick={() => onFindAsks(score.address)}
              disabled={askLoading}
              className="mt-4 w-full rounded-lg border border-neutral-700 px-4 py-2 text-sm font-semibold text-neutral-200 transition-colors hover:border-neutral-500 disabled:opacity-50"
            >
              {askLoading ? "Scanning the trust graph…" : "Find who to ask"}
            </button>

            {asks && (
              <>
                <div className="mt-4 flex items-center justify-between text-xs text-neutral-500">
                  <span>
                    {asks.hop1} trust you directly · {asks.hop2} reachable at
                    hop 2{asks.truncated ? " (sampled)" : ""}
                  </span>
                  {asks.candidates.length > 0 && (
                    <button
                      onClick={copyAsks}
                      className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-500"
                    >
                      {copied ? "Copied" : "Copy list"}
                    </button>
                  )}
                </div>

                {asks.candidates.length === 0 ? (
                  <p className="mt-3 text-sm text-neutral-400">
                    No hop-2 Backers found to ask.
                  </p>
                ) : (
                  <div className="mt-3 max-h-80 space-y-1 overflow-y-auto">
                    {asks.candidates.map((c, i) => (
                      <div
                        key={c.address}
                        className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-950 p-2"
                      >
                        <span className="w-5 shrink-0 text-right text-xs text-neutral-600">
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-neutral-200">
                            {asks.names.get(c.address) ?? shorten(c.address)}
                            {c.youTrust && (
                              <span className="ml-2 rounded bg-green-900/60 px-1.5 py-0.5 text-[10px] font-semibold text-green-300">
                                you trust them
                              </span>
                            )}
                          </div>
                          <div className="font-mono text-xs text-neutral-500">
                            {shorten(c.address)}
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-xs text-neutral-400">
                          {c.sharedIntermediaries} mutual
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Untrust bad accounts ──────────────────────────────────── */}
        <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
          <h2 className="text-lg font-semibold text-white">
            Prune your trust list
          </h2>
          <p className="mt-1 text-sm text-neutral-400">
            Scan everyone you currently trust, scored by their own Backers
            connection, and untrust weakly-connected (likely sybil) accounts.
          </p>
          <p className="mt-2 rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-500">
            Note: this won&apos;t change <em>your</em> score — the Backers score
            counts who trusts <em>you</em>, not who you trust. Pruning reduces
            your exposure to sybil tokens and stops you vouching for them.
          </p>

          {!connected ? (
            <a
              href={CIRCLES_MINIAPP_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-block rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-500"
            >
              Open in Circles to prune
            </a>
          ) : (
            <>
              <button
                onClick={onScan}
                disabled={scanning || untrusting}
                className="mt-4 w-full rounded-lg border border-neutral-700 px-4 py-2 text-sm font-semibold text-neutral-200 transition-colors hover:border-neutral-500 disabled:opacity-50"
              >
                {scanning ? "Scanning your trust list…" : "Scan my trust list"}
              </button>

              {scanned && rows.length === 0 && (
                <p className="mt-4 text-sm text-neutral-400">
                  You don&apos;t trust any accounts yet.
                </p>
              )}

              {rows.length > 0 && (
                <>
                  <div className="mt-4 flex items-center gap-2">
                    <label className="text-xs text-neutral-500">
                      Flag score below
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={threshold}
                      onChange={(e) => setThreshold(Number(e.target.value))}
                      className="w-16 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-white outline-none focus:border-green-600"
                    />
                    <button
                      onClick={selectBelowThreshold}
                      className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-500"
                    >
                      Select flagged
                    </button>
                    <span className="ml-auto text-xs text-neutral-500">
                      {rows.length} trusted
                    </span>
                  </div>

                  <div className="mt-3 max-h-80 space-y-1 overflow-y-auto">
                    {rows.map((r) => {
                      const s = r.score ?? 0;
                      const rb = band(s);
                      const checked = selected.has(r.address);
                      return (
                        <label
                          key={r.address}
                          className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2 transition-colors ${
                            checked
                              ? "border-red-700 bg-red-950/30"
                              : "border-neutral-800 bg-neutral-950 hover:border-neutral-700"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(r.address)}
                            className="h-4 w-4 accent-red-600"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm text-neutral-200">
                              {r.name ?? shorten(r.address)}
                            </div>
                            <div className="font-mono text-xs text-neutral-500">
                              {shorten(r.address)}
                            </div>
                          </div>
                          <div className={`text-sm font-semibold ${rb.color}`}>
                            {r.score === null ? "0" : s.toFixed(1)}
                          </div>
                        </label>
                      );
                    })}
                  </div>

                  <button
                    onClick={onUntrust}
                    disabled={untrusting || selected.size === 0}
                    className="mt-4 w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-50"
                  >
                    {untrusting
                      ? "Submitting…"
                      : `Untrust selected (${selected.size})`}
                  </button>
                </>
              )}

              {untrustHashes && untrustHashes.length > 0 && (
                <div className="mt-4 rounded-lg border border-green-800 bg-green-950/40 p-3 text-sm text-green-300">
                  Submitted{" "}
                  <a
                    href={`https://gnosisscan.io/tx/${untrustHashes[0]}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold underline"
                  >
                    {untrustHashes.length > 1
                      ? `${untrustHashes.length} transactions`
                      : "transaction"}
                  </a>
                  .
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {error && <Toast message={error} onDone={() => setError(null)} />}
    </main>
  );
}
