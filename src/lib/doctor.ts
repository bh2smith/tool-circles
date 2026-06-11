"use client";

import { CIRCLES_RPC, type PathData } from "./contract";
import { fetchOutgoingTrusts } from "./trust";

// General payment pathfinder. Unlike findPath (replenish), there is no
// ToTokens pin — the route may settle in any tokens the recipient accepts.
export async function findTransferPath(
  source: string,
  sink: string,
  targetFlow: bigint,
): Promise<PathData> {
  const res = await fetch(CIRCLES_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 0,
      method: "circlesV2_findPath",
      params: [
        {
          Source: source,
          Sink: sink,
          TargetFlow: targetFlow.toString(),
          WithWrap: true,
        },
      ],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message ?? "pathfinder error");
  return data.result as PathData;
}

export interface TokenHolding {
  owner: string; // token owner avatar, lowercased
  atto: bigint; // demurraged atto-CRC across all representations of the token
}

interface BalanceRow {
  tokenOwner: string;
  attoCircles: string;
  version: number;
}

// The sender's v2 holdings grouped by token owner (ERC1155 + wrapped variants
// summed), demurraged units, largest first. v1 tokens are excluded — they
// cannot route through the v2 Hub.
export async function fetchHoldingsByOwner(
  avatar: string,
): Promise<TokenHolding[]> {
  const res = await fetch(CIRCLES_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "circles_getTokenBalances",
      params: [avatar.toLowerCase()],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message ?? "balance query failed");
  const byOwner = new Map<string, bigint>();
  for (const row of data.result as BalanceRow[]) {
    if (row.version !== 2) continue;
    const owner = row.tokenOwner.toLowerCase();
    byOwner.set(owner, (byOwner.get(owner) ?? 0n) + BigInt(row.attoCircles));
  }
  return [...byOwner.entries()]
    .map(([owner, atto]) => ({ owner, atto }))
    .sort((a, b) => (b.atto > a.atto ? 1 : -1));
}

export interface CorridorDiagnosis {
  maxFlow: bigint; // most that can route from sender to recipient right now
  transferEdges: number; // size of the flow decomposition at the max probe
  totalHeld: bigint; // sender's total v2 balance
  acceptedHeld: bigint; // held value whose owner the recipient trusts directly
  acceptedCount: number;
  notAccepted: TokenHolding[]; // held tokens the recipient does NOT trust, desc
  senderOwnHeld: bigint; // sender's personal-token balance
  senderTokenAccepted: boolean; // recipient trusts the sender directly
}

// Probe the corridor at max flow and explain it: which of the sender's
// holdings the recipient accepts directly, and which can only route via
// intermediaries (each direct trust from the recipient is a guaranteed
// capacity unlock, up to the held amount).
export async function diagnoseCorridor(
  from: string,
  to: string,
  probe: bigint,
): Promise<CorridorDiagnosis> {
  const f = from.toLowerCase();
  const t = to.toLowerCase();
  const [path, holdings, trusts] = await Promise.all([
    findTransferPath(f, t, probe),
    fetchHoldingsByOwner(f),
    fetchOutgoingTrusts(t),
  ]);

  // Every avatar accepts its own token, so the recipient's set is trusts + self.
  const accepts = new Set(trusts);
  accepts.add(t);

  let totalHeld = 0n;
  let acceptedHeld = 0n;
  let acceptedCount = 0;
  let senderOwnHeld = 0n;
  const notAccepted: TokenHolding[] = [];
  for (const h of holdings) {
    totalHeld += h.atto;
    if (h.owner === f) senderOwnHeld = h.atto;
    if (accepts.has(h.owner)) {
      acceptedHeld += h.atto;
      acceptedCount++;
    } else {
      notAccepted.push(h);
    }
  }

  return {
    maxFlow: BigInt(path.maxFlow),
    transferEdges: path.transfers.length,
    totalHeld,
    acceptedHeld,
    acceptedCount,
    notAccepted,
    senderOwnHeld,
    senderTokenAccepted: accepts.has(f),
  };
}
