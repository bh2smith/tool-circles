"use client";

import { encodeUntrust } from "./contract";
import { circlesQuery } from "./query";

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

export interface AskCandidate {
  address: string;
  sharedIntermediaries: number; // mutual connections — higher = warmer ask
  youTrust: boolean; // you already trust them (reciprocation = warmest)
}

export interface AskCandidates {
  totalBackers: number;
  hop1Backers: number; // backers trusting you directly today
  hop2Backers: number; // backers reachable at hop 2 (the ask pool)
  candidates: AskCandidate[]; // top 50 by shared intermediaries
  truncated: boolean; // fan-out was capped for a heavily-trusted avatar
}

// Backers who reach you at hop 2 but don't trust you directly — the highest-
// leverage accounts to ask for a direct trust (each one shifts hop 2 -> hop 1).
// Computed server-side (graph fan-out), ranked by shared intermediaries.
export async function fetchAskCandidates(
  avatar: string,
): Promise<AskCandidates> {
  const res = await fetch("/api/trust-asks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ avatar }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? "could not compute ask list");
  return data as AskCandidates;
}

// The avatar's active outgoing trust edges (truster == avatar, not expired).
// Returns lowercased trustee addresses. These are the only trust edges the
// avatar can change on-chain.
export async function fetchOutgoingTrusts(avatar: string): Promise<string[]> {
  const rows = await circlesQuery({
    namespace: "V_CrcV2",
    table: "TrustRelations",
    filter: [{ column: "truster", value: avatar.toLowerCase() }],
    limit: 20000,
  });
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const seen = new Set<string>();
  for (const row of rows) {
    const trustee = String(row.trustee).toLowerCase();
    const expiry = BigInt(String(row.expiryTime ?? "0"));
    if (expiry > nowSec) seen.add(trustee);
  }
  return [...seen];
}
