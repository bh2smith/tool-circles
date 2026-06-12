"use client";

import { useEffect, useState } from "react";
import Toast from "@/components/Toast";
import Avatar from "@/components/Avatar";
import AddressField from "@/components/AddressField";
import {
  circlesProfileUrl,
  fetchCirclesProfiles,
  initCircles,
  resolveAddress,
  subscribeWallet,
  type CirclesProfile,
} from "@/lib/circles";
import {
  fetchTokenHolders,
  holdersToCsv,
  shareBps,
  type TokenDistribution,
} from "@/lib/distribution";
import { fmtCrc, shorten } from "@/lib/format";

const PAGE = 25;
const TOP_BARS = 10;

export default function HoldersPage() {
  const [avatar, setAvatar] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [dist, setDist] = useState<TokenDistribution | null>(null);
  const [profiles, setProfiles] = useState<Map<string, CirclesProfile>>(
    new Map(),
  );
  const [visible, setVisible] = useState(PAGE);
  const [error, setError] = useState<string | null>(null);

  // Read-only tool: the wallet (when present) only prefills the token field —
  // a personal token's address is the avatar's address.
  useEffect(() => {
    initCircles();
    return subscribeWallet((addr) => {
      setAvatar(addr);
      if (addr) setInput((prev) => (prev === "" ? addr : prev));
    });
  }, []);

  // Resolve profiles for the rows currently on screen (cached underneath).
  useEffect(() => {
    if (!dist) return;
    const accounts = dist.holders.slice(0, visible).map((h) => h.account);
    if (accounts.length === 0) return;
    let active = true;
    fetchCirclesProfiles(accounts).then((m) => {
      if (active) setProfiles((prev) => new Map([...prev, ...m]));
    });
    return () => {
      active = false;
    };
  }, [dist, visible]);

  async function onLookup() {
    setError(null);
    setDist(null);
    setVisible(PAGE);
    setLoading(true);
    try {
      const addr = await resolveAddress(input);
      if (!addr) throw new Error("Could not resolve that address or name.");
      const d = await fetchTokenHolders(addr);
      setToken(addr.toLowerCase());
      setDist(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "lookup failed");
    } finally {
      setLoading(false);
    }
  }

  function exportCsv() {
    if (!dist || !token) return;
    const blob = new Blob([holdersToCsv(dist)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `holders-${token}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const name = (account: string) => profiles.get(account)?.name ?? null;
  const image = (account: string) =>
    profiles.get(account)?.previewImageUrl ?? null;

  const top10 = dist
    ? dist.holders.slice(0, TOP_BARS).reduce((s, h) => s + h.demurraged, 0n)
    : 0n;

  return (
    <main className="flex-1 px-4 py-8">
      <div className="mx-auto max-w-md">
        <h1 className="text-2xl font-bold text-white">Token Holders</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Who holds a Circles token, and how concentrated it is. A personal or
          group token&apos;s address is the issuing avatar&apos;s address — so
          the default view is who holds <em>your</em> CRC.
        </p>

        <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
          <AddressField
            label="Token (avatar or group address)"
            value={input}
            onChange={setInput}
            avatar={avatar}
            onEnter={onLookup}
          />
          <button
            onClick={onLookup}
            disabled={loading}
            className="mt-4 w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-500 disabled:opacity-50"
          >
            {loading ? "Querying the indexer…" : "Show holders"}
          </button>
        </div>

        {dist && dist.holders.length === 0 && (
          <p className="mt-6 text-sm text-neutral-400">
            Nobody holds this token (or it isn&apos;t a Circles token).
          </p>
        )}

        {dist && dist.holders.length > 0 && (
          <>
            {/* ── Summary ────────────────────────────────────────────── */}
            <div className="mt-6 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-2">
                <div className="text-base font-semibold text-white">
                  {dist.holders.length.toLocaleString()}
                </div>
                <div className="text-neutral-500">holders</div>
              </div>
              <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-2">
                <div className="text-base font-semibold text-white">
                  {fmtCrc(dist.total)}
                </div>
                <div className="text-neutral-500">CRC held</div>
              </div>
              <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-2">
                <div className="text-base font-semibold text-white">
                  {(shareBps(top10, dist.total) / 100).toFixed(1)}%
                </div>
                <div className="text-neutral-500">in top {TOP_BARS}</div>
              </div>
            </div>

            {/* ── Top holders bars ───────────────────────────────────── */}
            <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">
                  Distribution
                </h2>
                <button
                  onClick={exportCsv}
                  className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-500"
                >
                  Export CSV
                </button>
              </div>
              <div className="mt-3 space-y-1">
                {dist.holders.slice(0, TOP_BARS).map((h) => {
                  const pct = shareBps(h.demurraged, dist.total) / 100;
                  return (
                    <div
                      key={h.account}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span className="w-24 shrink-0 truncate text-neutral-400">
                        {name(h.account) ?? shorten(h.account)}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded bg-neutral-800">
                        <div
                          className="h-full bg-green-600"
                          style={{ width: `${Math.max(1, pct)}%` }}
                        />
                      </div>
                      <span className="w-12 shrink-0 text-right text-neutral-400">
                        {pct.toFixed(1)}%
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* ── Holder list ──────────────────────────────────────── */}
              <div className="mt-4 space-y-1">
                {dist.holders.slice(0, visible).map((h, i) => (
                  <a
                    key={h.account}
                    href={circlesProfileUrl(h.account)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-950 p-2 transition-colors hover:border-neutral-600"
                  >
                    <span className="w-6 shrink-0 text-right text-xs text-neutral-600">
                      {i + 1}
                    </span>
                    <Avatar
                      src={image(h.account)}
                      alt={name(h.account) ?? h.account}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-neutral-200">
                        {name(h.account) ?? shorten(h.account)}
                        {token && h.account === token && (
                          <span className="ml-2 rounded bg-green-900/60 px-1.5 py-0.5 text-[10px] font-semibold text-green-300">
                            issuer
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-xs text-neutral-500">
                        {shorten(h.account)}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-xs text-neutral-400">
                      <div>{fmtCrc(h.demurraged)} CRC</div>
                      <div className="text-neutral-600">
                        {(shareBps(h.demurraged, dist.total) / 100).toFixed(1)}%
                      </div>
                    </div>
                  </a>
                ))}
              </div>
              {visible < dist.holders.length && (
                <button
                  onClick={() => setVisible((v) => v + PAGE * 2)}
                  className="mt-3 w-full rounded-lg border border-neutral-700 px-4 py-2 text-sm font-semibold text-neutral-200 transition-colors hover:border-neutral-500"
                >
                  Show more ({dist.holders.length - visible} remaining)
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {error && <Toast message={error} onDone={() => setError(null)} />}
    </main>
  );
}
