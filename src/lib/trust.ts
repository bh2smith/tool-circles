"use client";

import { CIRCLES_RPC, encodeUntrust } from "./contract";

export { encodeUntrust };

// Hop decay weights the Backers score uses (closer connections count for more).
// Shown in the UI for context; the score itself is computed server-side.
export const HOP_DECAY: Record<number, number> = {
  0: 1.0,
  1: 0.9,
  2: 0.8,
  3: 0.6,
  4: 0.4,
  5: 0.2,
};

export interface TrustScore {
  address: string;
  relativeScore: number; // 0..100
  targetsReached: number;
  totalTargets: number;
  penetrationRate: number; // 0..1
  hopBreakdown: Record<string, number> | null; // hop -> backers reached at that hop
}

interface ScoreResultItem {
  address: string;
  relative_score: number;
  targets_reached: number;
  total_targets: number;
  penetration_rate: number;
  hop_breakdown?: { targets_by_hop?: Record<string, number> } | null;
}

function toScore(r: ScoreResultItem): TrustScore {
  return {
    address: r.address.toLowerCase(),
    relativeScore: r.relative_score,
    targetsReached: r.targets_reached,
    totalTargets: r.total_targets,
    penetrationRate: r.penetration_rate,
    hopBreakdown: r.hop_breakdown?.targets_by_hop ?? null,
  };
}

// Chunk size kept well under the analytics endpoint's avatar cap (verified to
// accept 250 in one call; we stay conservative for headroom).
const SCORE_CHUNK = 150;

async function postScore(
  avatars: string[],
  includeDetails: boolean,
): Promise<TrustScore[]> {
  const res = await fetch("/api/trust-score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ avatars, includeDetails }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error ?? "scoring failed");
  }
  return (data.results as ScoreResultItem[]).map(toScore);
}

export async function fetchTrustScore(address: string): Promise<TrustScore> {
  const [one] = await postScore([address], true);
  if (!one) throw new Error("no score returned for this address");
  return one;
}

// Score many avatars (the connected avatar's trustees). Returns a map keyed by
// lowercased address; chunks transparently.
export async function fetchTrustScores(
  addresses: string[],
): Promise<Map<string, TrustScore>> {
  const out = new Map<string, TrustScore>();
  for (let i = 0; i < addresses.length; i += SCORE_CHUNK) {
    const chunk = addresses.slice(i, i + SCORE_CHUNK);
    const scores = await postScore(chunk, false);
    for (const s of scores) out.set(s.address, s);
  }
  return out;
}

// The avatar's active outgoing trust edges (truster == avatar, not expired).
// Returns lowercased trustee addresses. These are the only trust edges the
// avatar can change on-chain.
export async function fetchOutgoingTrusts(avatar: string): Promise<string[]> {
  const res = await fetch(CIRCLES_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "circles_query",
      params: [
        {
          Namespace: "V_CrcV2",
          Table: "TrustRelations",
          Filter: [
            {
              Type: "FilterPredicate",
              FilterType: "Equals",
              Column: "truster",
              Value: avatar.toLowerCase(),
            },
          ],
          Limit: 20000,
        },
      ],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message ?? "trust query failed");
  const { columns, rows } = data.result as {
    columns: string[];
    rows: unknown[][];
  };
  const ti = columns.indexOf("trustee");
  const ei = columns.indexOf("expiryTime");
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const seen = new Set<string>();
  for (const row of rows) {
    const trustee = String(row[ti]).toLowerCase();
    const expiry = BigInt(String(row[ei] ?? "0"));
    if (expiry > nowSec) seen.add(trustee);
  }
  return [...seen];
}
