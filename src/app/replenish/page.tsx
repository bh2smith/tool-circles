"use client";

import { useCallback, useEffect, useState } from "react";
import { formatEther, parseEther } from "viem";
import Toast from "@/components/Toast";
import ConnectGate from "@/components/ConnectGate";
import {
  initCircles,
  isMiniappMode,
  sendTransactions,
  subscribeWallet,
} from "@/lib/circles";
import {
  assertVerticesRegistered,
  buildReplenishBatch,
  findPath,
  getTokenBalances,
} from "@/lib/contract";

// Probe amount for the max-replenishable query — far above any real balance, so
// the pathfinder returns maxFlow = everything routable. Mirrors the reference
// HTML's parseEth("100000000000").
const MAX_PROBE = parseEther("100000000000");

// Trim a CRC value for display without scientific notation or a wall of dust.
function fmtCrc(atto: bigint): string {
  const n = Number(formatEther(atto));
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export default function ReplenishPage() {
  const [ready, setReady] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [maxFlow, setMaxFlow] = useState<bigint | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [amount, setAmount] = useState("");
  const [preview, setPreview] = useState<{
    amount: bigint;
    transfers: number;
    edges: number;
  } | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Wire the host wallet once, then track the connected avatar. `subscribeWallet`
  // fires its callback immediately, so `ready` flips on first paint without a
  // synchronous setState in the effect body.
  useEffect(() => {
    initCircles();
    return subscribeWallet((addr) => {
      setAvatar(addr);
      setReady(true);
    });
  }, []);

  // Refresh the max replenishable whenever the avatar changes. The first setState
  // lands after `await`, so this is not a synchronous effect update.
  useEffect(() => {
    if (!avatar) return;
    let active = true;
    (async () => {
      try {
        const path = await findPath(avatar, avatar, MAX_PROBE);
        if (!active) return;
        const max = BigInt(path.maxFlow);
        setMaxFlow(max);
        setAmount(max > 0n ? formatEther(max) : "");
        setPreview(null);
        setTxHash(null);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "failed to query pathfinder");
      }
    })();
    return () => {
      active = false;
    };
  }, [avatar]);

  const loading = avatar !== null && maxFlow === null && error === null;

  // Parse the CRC input to atto, clamped to maxFlow. Returns null on bad input.
  const resolveAmount = useCallback((): bigint | null => {
    if (maxFlow === null) return null;
    let want: bigint;
    try {
      want = parseEther(amount.trim() || "0");
    } catch {
      return null;
    }
    if (want <= 0n) return null;
    return want > maxFlow ? maxFlow : want;
  }, [amount, maxFlow]);

  // Preview = the script's DRY_RUN: find the path at the chosen amount and show
  // the resolved amount + transfer/edge counts without submitting.
  async function onPreview() {
    setError(null);
    setTxHash(null);
    const want = resolveAmount();
    if (want === null) {
      setError("Enter a valid amount.");
      return;
    }
    setSubmitting(true);
    try {
      if (!avatar) throw new Error("no connected avatar");
      const [path, balances] = await Promise.all([
        findPath(avatar, avatar, want),
        getTokenBalances(avatar),
      ]);
      const { matrix } = buildReplenishBatch(path, balances, avatar, want);
      setPreview({
        amount: want,
        transfers: path.transfers.length,
        edges: matrix.flow.filter((e) => e.streamSinkId === 1).length,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "preview failed");
    } finally {
      setSubmitting(false);
    }
  }

  // Replenish: find path at chosen amount -> build flow matrix -> encode ->
  // sendTransactions (the avatar/Safe executes operateFlowMatrix as msg.sender).
  async function onReplenish() {
    setError(null);
    setTxHash(null);
    const want = resolveAmount();
    if (want === null) {
      setError("Enter a valid amount.");
      return;
    }
    setSubmitting(true);
    try {
      if (!avatar) throw new Error("no connected avatar");
      const [path, balances] = await Promise.all([
        findPath(avatar, avatar, want),
        getTokenBalances(avatar),
      ]);
      // Builds [unwrap…, operateFlowMatrix, re-wrap…] — collapses to a single
      // operateFlowMatrix when no wrapped balance is on the path.
      const { txs, matrix } = buildReplenishBatch(path, balances, avatar, want);
      // Fail fast on any non-avatar vertex rather than an opaque on-chain revert.
      await assertVerticesRegistered(matrix.flowVertices);
      const hashes = await sendTransactions(txs);
      setTxHash(Array.isArray(hashes) ? hashes[0] : String(hashes));
    } catch (e) {
      setError(e instanceof Error ? e.message : "replenish failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready) return null;

  if (!isMiniappMode() || !avatar) {
    return (
      <main className="flex-1 px-4 py-10">
        <ConnectGate />
      </main>
    );
  }

  const nothing = maxFlow !== null && maxFlow === 0n;
  const busy = submitting || loading;

  return (
    <main className="flex-1 px-4 py-8">
      <div className="mx-auto max-w-md">
        <h1 className="text-2xl font-bold text-white">Replenish CRC</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Convert foreign CRC you hold back into fresh personal CRC. This routes
          a self-to-self transfer that settles in your own token.
        </p>

        <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
          <div className="text-xs uppercase tracking-wide text-neutral-500">
            Avatar
          </div>
          <div className="mt-1 break-all font-mono text-sm text-neutral-300">
            {avatar}
          </div>

          <div className="mt-4 text-xs uppercase tracking-wide text-neutral-500">
            Max replenishable
          </div>
          <div className="mt-1 text-xl font-semibold text-white">
            {loading ? "…" : maxFlow !== null ? `${fmtCrc(maxFlow)} CRC` : "—"}
          </div>

          {nothing ? (
            <p className="mt-4 text-sm text-neutral-400">
              Nothing to replenish — you hold no foreign CRC that can be routed
              back into your token.
            </p>
          ) : (
            <>
              <label className="mt-5 block text-xs uppercase tracking-wide text-neutral-500">
                Amount (CRC)
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setPreview(null);
                }}
                disabled={busy || maxFlow === null}
                placeholder="0.0"
                className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-sm text-white outline-none focus:border-green-600 disabled:opacity-50"
              />
              <p className="mt-1 text-xs text-neutral-500">
                Defaults to the max; larger values are clamped.
              </p>

              <div className="mt-4 flex gap-2">
                <button
                  onClick={onPreview}
                  disabled={busy || maxFlow === null}
                  className="flex-1 rounded-lg border border-neutral-700 px-4 py-2 text-sm font-semibold text-neutral-200 transition-colors hover:border-neutral-500 disabled:opacity-50"
                >
                  Preview
                </button>
                <button
                  onClick={onReplenish}
                  disabled={busy || maxFlow === null}
                  className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-500 disabled:opacity-50"
                >
                  {submitting ? "Working…" : "Replenish"}
                </button>
              </div>

              {preview && (
                <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-sm text-neutral-300">
                  <div>
                    Routing{" "}
                    <span className="font-semibold text-white">
                      {fmtCrc(preview.amount)} CRC
                    </span>{" "}
                    via {preview.transfers} transfers, {preview.edges} terminal
                    edge{preview.edges === 1 ? "" : "s"}.
                  </div>
                </div>
              )}
            </>
          )}

          {txHash && (
            <div className="mt-4 rounded-lg border border-green-800 bg-green-950/40 p-3 text-sm text-green-300">
              Submitted.{" "}
              <a
                href={`https://gnosisscan.io/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
                className="font-semibold underline"
              >
                View on Gnosisscan
              </a>
            </div>
          )}
        </div>
      </div>

      {error && <Toast message={error} onDone={() => setError(null)} />}
    </main>
  );
}
