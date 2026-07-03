"use client";

import { useCallback, useEffect, useState } from "react";
import Toast from "@/components/Toast";
import Avatar from "@/components/Avatar";
import AddressField from "@/components/AddressField";
import ConnectGate from "@/components/ConnectGate";
import {
  circlesProfileUrl,
  fetchCirclesProfiles,
  initCircles,
  isMiniappMode,
  resolveAddress,
  sendTransactions,
  subscribeWallet,
  type CirclesProfile,
} from "@/lib/circles";
import { encodeTrust, encodeUntrust, HUB_ADDRESS } from "@/lib/contract";
import { fmtCrc, fmtDate, shorten } from "@/lib/format";
import {
  fetchInvitees,
  fetchPendingInvites,
  fetchPersonalBalance,
  INVITATION_COST,
  isRegistered,
  type Invitee,
} from "@/lib/invite";

export default function InvitePage() {
  const [ready, setReady] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [pending, setPending] = useState<string[] | null>(null);
  const [invitees, setInvitees] = useState<Invitee[] | null>(null);
  const [profiles, setProfiles] = useState<Map<string, CirclesProfile>>(
    new Map(),
  );
  const [submitting, setSubmitting] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initCircles();
    return subscribeWallet((addr) => {
      setAvatar(addr);
      setReady(true);
    });
  }, []);

  const refresh = useCallback(async (addr: string) => {
    const [bal, pend, inv] = await Promise.all([
      fetchPersonalBalance(addr),
      fetchPendingInvites(addr),
      fetchInvitees(addr),
    ]);
    setBalance(bal);
    setPending(pend);
    setInvitees(inv);
    if (inv.length > 0) {
      const m = await fetchCirclesProfiles(inv.map((i) => i.address));
      setProfiles((prev) => new Map([...prev, ...m]));
    }
  }, []);

  useEffect(() => {
    if (!avatar) return;
    let active = true;
    (async () => {
      try {
        await refresh(avatar);
      } catch (e) {
        if (active)
          setError(e instanceof Error ? e.message : "failed to load invites");
      }
    })();
    return () => {
      active = false;
    };
  }, [avatar, refresh]);

  async function onInvite() {
    if (!avatar) return;
    setError(null);
    setTxHash(null);
    setSubmitting(true);
    try {
      const addr = await resolveAddress(input);
      if (!addr) throw new Error("Enter the new member's wallet address.");
      if (addr.toLowerCase() === avatar.toLowerCase())
        throw new Error("You can't invite yourself.");
      if (await isRegistered(addr))
        throw new Error(
          "That address is already a registered Circles avatar — nothing to invite.",
        );
      const hashes = await sendTransactions([
        { to: HUB_ADDRESS, data: encodeTrust(addr), value: "0x0" },
      ]);
      setTxHash(Array.isArray(hashes) ? hashes[0] : String(hashes));
      setInput("");
      await refresh(avatar);
    } catch (e) {
      setError(e instanceof Error ? e.message : "invite failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function onRevoke(addr: string) {
    if (!avatar) return;
    setError(null);
    setRevoking(addr);
    try {
      await sendTransactions([
        { to: HUB_ADDRESS, data: encodeUntrust(addr), value: "0x0" },
      ]);
      setPending((prev) => prev?.filter((p) => p !== addr) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "revoke failed");
    } finally {
      setRevoking(null);
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

  const short = balance !== null && balance < INVITATION_COST;
  const name = (a: string) => profiles.get(a)?.name ?? null;
  const image = (a: string) => profiles.get(a)?.previewImageUrl ?? null;

  return (
    <main className="flex-1 px-4 py-8">
      <div className="mx-auto max-w-md">
        <h1 className="text-2xl font-bold text-white">Invite</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Bring someone into Circles: trust their wallet address, then have them
          register in the Circles wallet naming you as inviter. When they
          register, {fmtCrc(INVITATION_COST)} CRC is burned from your personal
          tokens and they receive a welcome bonus.
        </p>

        {/* ── Invite ────────────────────────────────────────────────── */}
        <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
          <AddressField
            label="New member's wallet address"
            value={input}
            onChange={setInput}
            onEnter={onInvite}
            placeholder="0x…"
          />
          <div
            className={`mt-3 rounded-lg border p-3 text-xs ${
              short
                ? "border-yellow-800 bg-yellow-950/30 text-yellow-300"
                : "border-neutral-800 bg-neutral-950 text-neutral-400"
            }`}
          >
            You hold{" "}
            <span className="font-semibold">
              {balance === null ? "…" : fmtCrc(balance)} CRC
            </span>{" "}
            of your own token; the invite burns {fmtCrc(INVITATION_COST)} CRC
            when they register
            {short &&
              " — top up your own CRC first, or the registration will fail"}
            .
          </div>
          <button
            onClick={onInvite}
            disabled={submitting}
            className="mt-4 w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-500 disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Invite (trust this address)"}
          </button>

          {txHash && (
            <div className="mt-4 rounded-lg border border-green-800 bg-green-950/40 p-3 text-sm text-green-300">
              Invitation extended.{" "}
              <a
                href={`https://gnosisscan.io/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
                className="font-semibold underline"
              >
                View on Gnosisscan
              </a>
              . Now have them open the Circles wallet with that address and
              register — you&apos;ll appear as a valid inviter.
            </div>
          )}
        </div>

        {/* ── Pending ───────────────────────────────────────────────── */}
        {pending && pending.length > 0 && (
          <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
            <h2 className="text-lg font-semibold text-white">
              Outstanding invites
            </h2>
            <p className="mt-1 text-sm text-neutral-400">
              Addresses you trust that never registered. Revoking the trust
              withdraws the invitation (and your exposure).
            </p>
            <div className="mt-3 max-h-80 space-y-1 overflow-y-auto">
              {pending.map((p) => (
                <div
                  key={p}
                  className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-950 p-2"
                >
                  <div className="min-w-0 flex-1 font-mono text-xs text-neutral-300">
                    {shorten(p)}
                  </div>
                  <button
                    onClick={() => onRevoke(p)}
                    disabled={revoking !== null}
                    className="rounded border border-red-900 px-2 py-1 text-xs font-semibold text-red-400 transition-colors hover:border-red-700 disabled:opacity-50"
                  >
                    {revoking === p ? "Revoking…" : "Revoke"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Invited ───────────────────────────────────────────────── */}
        <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
          <h2 className="text-lg font-semibold text-white">
            People you invited
          </h2>
          {invitees === null ? (
            <p className="mt-2 text-sm text-neutral-400">Loading…</p>
          ) : invitees.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-400">
              Nobody has registered through your invitation yet.
            </p>
          ) : (
            <div className="mt-3 max-h-80 space-y-1 overflow-y-auto">
              {invitees.map((inv) => (
                <a
                  key={inv.address}
                  href={circlesProfileUrl(inv.address)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-950 p-2 transition-colors hover:border-neutral-600"
                >
                  <Avatar
                    src={image(inv.address)}
                    alt={name(inv.address) ?? inv.address}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-neutral-200">
                      {name(inv.address) ?? shorten(inv.address)}
                    </div>
                    <div className="font-mono text-xs text-neutral-500">
                      {shorten(inv.address)}
                    </div>
                  </div>
                  <div className="shrink-0 text-xs text-neutral-500">
                    {fmtDate(inv.timestamp)}
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && <Toast message={error} onDone={() => setError(null)} />}
    </main>
  );
}
