"use client";

import Link from "next/link";
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
import { fmtCrc, fmtDuration, shorten } from "@/lib/format";
import {
  fetchPortfolio,
  projectHolding,
  type IssuerStatus,
  type Portfolio,
} from "@/lib/portfolio";

const PAGE = 25;
const STALE_MINT_SECONDS = 30 * 24 * 3600;

function chips(
  status: IssuerStatus | undefined,
  h: { isSelf: boolean; v1: boolean; wrapped: bigint },
): { label: string; cls: string }[] {
  const out: { label: string; cls: string }[] = [];
  const now = Math.floor(Date.now() / 1000);
  if (h.isSelf)
    out.push({ label: "you", cls: "bg-green-900/60 text-green-300" });
  if (h.v1) out.push({ label: "v1", cls: "bg-neutral-800 text-neutral-400" });
  if (status?.type === "group")
    out.push({ label: "group", cls: "bg-blue-900/60 text-blue-300" });
  if (status?.stopped)
    out.push({ label: "stopped", cls: "bg-red-900/60 text-red-300" });
  else if (
    status?.type === "human" &&
    status.lastMint !== null &&
    now - status.lastMint > STALE_MINT_SECONDS
  )
    out.push({
      label: `idle ${fmtDuration(now - status.lastMint)}`,
      cls: "bg-yellow-900/60 text-yellow-300",
    });
  if (status?.type === "human" && status.incomingTrusts === 0)
    out.push({ label: "untrusted", cls: "bg-red-900/60 text-red-300" });
  if (h.wrapped > 0n)
    out.push({ label: "wrapped", cls: "bg-neutral-800 text-neutral-400" });
  return out;
}

export default function PortfolioPage() {
  const [avatar, setAvatar] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [inspected, setInspected] = useState<string | null>(null);
  const [pf, setPf] = useState<Portfolio | null>(null);
  const [profiles, setProfiles] = useState<Map<string, CirclesProfile>>(
    new Map(),
  );
  const [visible, setVisible] = useState(PAGE);
  const [error, setError] = useState<string | null>(null);

  // Read-only tool: the wallet (when present) prefills the field and triggers
  // an initial inspection of the connected avatar.
  useEffect(() => {
    initCircles();
    return subscribeWallet((addr) => {
      setAvatar(addr);
      if (addr) setInput((prev) => (prev === "" ? addr : prev));
    });
  }, []);

  useEffect(() => {
    if (!pf) return;
    const owners = pf.issuers.slice(0, visible).map((h) => h.owner);
    if (owners.length === 0) return;
    let active = true;
    fetchCirclesProfiles(owners).then((m) => {
      if (active) setProfiles((prev) => new Map([...prev, ...m]));
    });
    return () => {
      active = false;
    };
  }, [pf, visible]);

  async function onInspect() {
    setError(null);
    setPf(null);
    setVisible(PAGE);
    setLoading(true);
    try {
      const addr = await resolveAddress(input);
      if (!addr) throw new Error("Could not resolve that address or name.");
      setInspected(addr.toLowerCase());
      setPf(await fetchPortfolio(addr));
    } catch (e) {
      setError(e instanceof Error ? e.message : "inspection failed");
    } finally {
      setLoading(false);
    }
  }

  const name = (a: string) => profiles.get(a)?.name ?? null;
  const image = (a: string) => profiles.get(a)?.previewImageUrl ?? null;
  const isOwn = !!avatar && !!inspected && avatar.toLowerCase() === inspected;

  // Projections are linear in the static balance, so the totals project as
  // the sum of the per-issuer projections.
  const proj = pf
    ? pf.issuers.reduce(
        (acc, h) => ({
          d30: acc.d30 + projectHolding(h, pf.factors30),
          d365: acc.d365 + projectHolding(h, pf.factors365),
        }),
        { d30: 0n, d365: 0n },
      )
    : null;

  return (
    <main className="flex-1 px-4 py-8">
      <div className="mx-auto max-w-md">
        <h1 className="text-2xl font-bold text-white">Portfolio</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Every CRC holding grouped by issuer: how much each is worth today,
          what demurrage does to it, and which issuers have gone dead.
        </p>

        <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
          <AddressField
            label="Avatar"
            value={input}
            onChange={setInput}
            avatar={avatar}
            onEnter={onInspect}
          />
          <button
            onClick={onInspect}
            disabled={loading}
            className="mt-4 w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-500 disabled:opacity-50"
          >
            {loading ? "Reading balances…" : "Inspect"}
          </button>
        </div>

        {pf && pf.issuers.length === 0 && (
          <p className="mt-6 text-sm text-neutral-400">
            No CRC balances found for this avatar.
          </p>
        )}

        {pf && pf.issuers.length > 0 && (
          <>
            {/* ── Totals ─────────────────────────────────────────────── */}
            <div className="mt-6 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-2">
                <div className="text-base font-semibold text-white">
                  {fmtCrc(pf.totals.all)}
                </div>
                <div className="text-neutral-500">CRC total</div>
              </div>
              <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-2">
                <div className="text-base font-semibold text-green-400">
                  {fmtCrc(pf.totals.own)}
                </div>
                <div className="text-neutral-500">own token</div>
              </div>
              <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-2">
                <div className="text-base font-semibold text-yellow-400">
                  {fmtCrc(pf.totals.foreign)}
                </div>
                <div className="text-neutral-500">foreign</div>
              </div>
            </div>

            {proj && (
              <div className="mt-2 rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-400">
                Left untouched, demurrage takes these holdings to{" "}
                <span className="font-semibold text-neutral-200">
                  {fmtCrc(proj.d30)} CRC
                </span>{" "}
                in 30 days and{" "}
                <span className="font-semibold text-neutral-200">
                  {fmtCrc(proj.d365)} CRC
                </span>{" "}
                in a year
                {pf.totals.wrapped > 0n && (
                  <> · {fmtCrc(pf.totals.wrapped)} CRC of it is ERC20-wrapped</>
                )}
                {pf.totals.v1 > 0n && (
                  <> · {fmtCrc(pf.totals.v1)} CRC is legacy v1</>
                )}
                .
              </div>
            )}

            {/* ── Issuers ────────────────────────────────────────────── */}
            <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
              <h2 className="text-lg font-semibold text-white">By issuer</h2>
              <div className="mt-3 space-y-1">
                {pf.issuers.slice(0, visible).map((h) => {
                  const s = pf.status.get(h.owner);
                  return (
                    <div
                      key={`${h.owner}-${h.v1 ? 1 : 2}`}
                      className="rounded-lg border border-neutral-800 bg-neutral-950 p-2"
                    >
                      <div className="flex items-center gap-3">
                        <a
                          href={circlesProfileUrl(h.owner)}
                          target="_blank"
                          rel="noreferrer"
                          className="flex min-w-0 flex-1 items-center gap-3 hover:opacity-80"
                        >
                          <Avatar
                            src={image(h.owner)}
                            alt={name(h.owner) ?? h.owner}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1 text-sm text-neutral-200">
                              <span className="truncate">
                                {name(h.owner) ?? shorten(h.owner)}
                              </span>
                              {chips(s, h).map((c) => (
                                <span
                                  key={c.label}
                                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${c.cls}`}
                                >
                                  {c.label}
                                </span>
                              ))}
                            </div>
                            <div className="font-mono text-xs text-neutral-500">
                              {shorten(h.owner)}
                            </div>
                          </div>
                        </a>
                        <div className="shrink-0 text-right">
                          <div className="text-sm font-semibold text-neutral-200">
                            {fmtCrc(h.demurraged)} CRC
                          </div>
                          <div className="text-[10px] text-neutral-600">
                            30d {fmtCrc(projectHolding(h, pf.factors30))} · 1y{" "}
                            {fmtCrc(projectHolding(h, pf.factors365))}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {visible < pf.issuers.length && (
                <button
                  onClick={() => setVisible((v) => v + PAGE * 2)}
                  className="mt-3 w-full rounded-lg border border-neutral-700 px-4 py-2 text-sm font-semibold text-neutral-200 transition-colors hover:border-neutral-500"
                >
                  Show more ({pf.issuers.length - visible} remaining)
                </button>
              )}

              {isOwn && pf.totals.foreign > 0n && (
                <p className="mt-4 text-xs text-neutral-500">
                  Foreign CRC (especially from dead issuers) is what{" "}
                  <Link
                    href="/replenish"
                    className="font-semibold text-green-500 hover:text-green-400"
                  >
                    Replenish
                  </Link>{" "}
                  converts back into your own token.
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {error && <Toast message={error} onDone={() => setError(null)} />}
    </main>
  );
}
