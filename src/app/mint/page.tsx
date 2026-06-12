"use client";

import { useCallback, useEffect, useState } from "react";
import Toast from "@/components/Toast";
import ConnectGate from "@/components/ConnectGate";
import {
  initCircles,
  isMiniappMode,
  sendTransactions,
  subscribeWallet,
} from "@/lib/circles";
import { HUB_ADDRESS } from "@/lib/contract";
import { fmtCrc, fmtDate, fmtDuration } from "@/lib/format";
import {
  encodePersonalMint,
  fetchMintHistory,
  fetchMintStatus,
  MAX_CLAIM_SECONDS,
  type MintEvent,
  type MintStatus,
} from "@/lib/mint";

const nowSec = () => Math.floor(Date.now() / 1000);

export default function MintPage() {
  const [ready, setReady] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [status, setStatus] = useState<MintStatus | null>(null);
  const [history, setHistory] = useState<MintEvent[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Re-render once a second so the "+1 CRC in …" countdown stays live.
  const [clock, setClock] = useState(nowSec());

  useEffect(() => {
    initCircles();
    return subscribeWallet((addr) => {
      setAvatar(addr);
      setReady(true);
    });
  }, []);

  const refresh = useCallback(async (addr: string) => {
    const [s, h] = await Promise.all([
      fetchMintStatus(addr),
      fetchMintHistory(addr),
    ]);
    setStatus(s);
    setHistory(h);
  }, []);

  useEffect(() => {
    if (!avatar) return;
    let active = true;
    (async () => {
      try {
        await refresh(avatar);
      } catch (e) {
        if (active)
          setError(
            e instanceof Error ? e.message : "failed to load mint status",
          );
      }
    })();
    return () => {
      active = false;
    };
  }, [avatar, refresh]);

  useEffect(() => {
    const t = setInterval(() => setClock(nowSec()), 1000);
    return () => clearInterval(t);
  }, []);

  // The next whole CRC lands at the hour boundary after endPeriod; refetch
  // just past it so the claimable number stays truthful.
  const nextTickAt =
    status && status.claimable > 0n ? status.endPeriod + 3600 : null;
  useEffect(() => {
    if (!avatar || !nextTickAt) return;
    const delay = (Math.max(0, nextTickAt - nowSec()) + 1) * 1000;
    const t = setTimeout(() => refresh(avatar).catch(() => {}), delay);
    return () => clearTimeout(t);
  }, [avatar, nextTickAt, refresh]);

  async function onMint() {
    if (!avatar) return;
    setError(null);
    setTxHash(null);
    setSubmitting(true);
    try {
      const hashes = await sendTransactions([
        { to: HUB_ADDRESS, data: encodePersonalMint(), value: "0x0" },
      ]);
      setTxHash(Array.isArray(hashes) ? hashes[0] : String(hashes));
      await refresh(avatar);
    } catch (e) {
      setError(e instanceof Error ? e.message : "mint failed");
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

  const loading = status === null;
  const windowSec = status ? status.endPeriod - status.startPeriod : 0;
  // calculateIssuance reports the accrual window only while something is
  // claimable; treat within-an-hour of the 2-week limit as capped.
  const capped =
    status !== null &&
    status.claimable > 0n &&
    windowSec >= MAX_CLAIM_SECONDS - 3600;
  const capProgress =
    status && status.claimable > 0n
      ? Math.min(1, windowSec / MAX_CLAIM_SECONDS)
      : 0;

  return (
    <main className="flex-1 px-4 py-8">
      <div className="mx-auto max-w-md">
        <h1 className="text-2xl font-bold text-white">Mint CRC</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Your avatar accrues 1 CRC per hour. Claim it here — accrual stops
          growing two weeks after your last mint, so unclaimed time beyond that
          is lost.
        </p>

        <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
          {loading ? (
            <div className="text-sm text-neutral-400">Loading…</div>
          ) : !status.isHuman ? (
            <p className="text-sm text-neutral-400">
              This avatar is not a registered human — only human avatars mint
              personal CRC.
            </p>
          ) : status.stopped ? (
            <p className="text-sm text-neutral-400">
              This avatar has permanently stopped minting (
              <span className="font-mono">stop()</span> was called). Existing
              balances are unaffected.
            </p>
          ) : (
            <>
              <div className="text-xs uppercase tracking-wide text-neutral-500">
                Claimable now
              </div>
              <div className="mt-1 text-4xl font-bold text-white">
                {fmtCrc(status.claimable)}{" "}
                <span className="text-lg font-semibold text-neutral-400">
                  CRC
                </span>
              </div>
              {nextTickAt && !capped && (
                <div className="mt-1 text-xs text-neutral-500">
                  +1 CRC in {fmtDuration(Math.max(0, nextTickAt - clock))}
                </div>
              )}

              {status.claimable > 0n && (
                <div className="mt-4">
                  <div className="h-2 overflow-hidden rounded bg-neutral-800">
                    <div
                      className={`h-full ${capped ? "bg-red-500" : "bg-green-600"}`}
                      style={{ width: `${capProgress * 100}%` }}
                    />
                  </div>
                  <div
                    className={`mt-1 text-xs ${capped ? "text-red-400" : "text-neutral-500"}`}
                  >
                    {capped
                      ? "Accrual is capped — you're losing CRC. Mint now."
                      : `Accruing for ${fmtDuration(windowSec)} — caps in ${fmtDuration(
                          MAX_CLAIM_SECONDS - windowSec,
                        )}`}
                  </div>
                </div>
              )}

              <button
                onClick={onMint}
                disabled={submitting || status.claimable === 0n}
                className="mt-5 w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-500 disabled:opacity-50"
              >
                {submitting
                  ? "Minting…"
                  : status.claimable === 0n
                    ? "Nothing to claim yet"
                    : `Mint ${fmtCrc(status.claimable)} CRC`}
              </button>

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
            </>
          )}
        </div>

        {history && history.length > 0 && (
          <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
            <h2 className="text-lg font-semibold text-white">Mint history</h2>
            <div className="mt-3 max-h-80 space-y-1 overflow-y-auto">
              {history.map((m) => (
                <a
                  key={m.txHash}
                  href={`https://gnosisscan.io/tx/${m.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-950 p-2 text-sm transition-colors hover:border-neutral-600"
                >
                  <span className="text-neutral-400">
                    {fmtDate(m.timestamp)}
                  </span>
                  <span className="text-neutral-500">
                    {fmtDuration(m.periodSeconds)} accrued
                  </span>
                  <span className="font-semibold text-neutral-200">
                    {fmtCrc(m.amount)} CRC
                  </span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && <Toast message={error} onDone={() => setError(null)} />}
    </main>
  );
}
