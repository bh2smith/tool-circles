import { getTokenBalances, HUB_ADDRESS, publicClient } from "./contract";
import {
  dayOf,
  fetchDemurrageFactors,
  staticToDemurraged,
  type DemurrageFactors,
} from "./demurrage";
import { hubMintAbi } from "./mint";
import { circlesQuery } from "./query";

// Portfolio: every CRC holding grouped by issuing avatar, with the holding's
// shape (native ERC1155 vs ERC20-wrapped), demurrage projections, and
// dead-issuer signals. All reads; the demurrage math reuses the Hub's own
// conversion factors (see demurrage.ts).

export interface IssuerHolding {
  owner: string; // issuing avatar (lowercased)
  isSelf: boolean;
  v1: boolean; // legacy Circles bucket
  demurraged: bigint; // total today, atto
  staticAtto: bigint; // static total — the basis for projections
  wrapped: bigint; // portion held as ERC20 wrappers (demurraged units)
}

export interface IssuerStatus {
  type: "human" | "group" | "organization" | "unknown";
  stopped: boolean;
  lastMint: number | null; // unix sec of last personalMint (humans only)
  incomingTrusts: number; // active edges trusting the issuer
}

export interface Portfolio {
  issuers: IssuerHolding[]; // descending by balance
  status: Map<string, IssuerStatus>; // keyed by issuer (v2 issuers only)
  totals: {
    all: bigint;
    own: bigint;
    foreign: bigint;
    wrapped: bigint;
    v1: bigint;
  };
  factors30: DemurrageFactors; // Hub conversion factors 30 days out
  factors365: DemurrageFactors; // … and one year out
}

// Look up "last mint" for at most this many issuers (one light query each).
const LAST_MINT_CAP = 40;

function avatarType(t: string): IssuerStatus["type"] {
  if (t.endsWith("RegisterHuman") || t.endsWith("Signup")) return "human";
  if (t.endsWith("RegisterGroup")) return "group";
  if (t.endsWith("RegisterOrganization")) return "organization";
  return "unknown";
}

async function fetchIssuerStatus(
  issuers: string[],
): Promise<Map<string, IssuerStatus>> {
  const status = new Map<string, IssuerStatus>();
  if (issuers.length === 0) return status;
  for (const i of issuers) {
    status.set(i, {
      type: "unknown",
      stopped: false,
      lastMint: null,
      incomingTrusts: 0,
    });
  }

  const [types, stoppedFlags, trustRows] = await Promise.all([
    circlesQuery({
      namespace: "V_CrcV2",
      table: "Avatars",
      filter: [{ column: "avatar", value: issuers, filterType: "In" }],
      limit: issuers.length,
    }),
    publicClient.multicall({
      contracts: issuers.map((i) => ({
        address: HUB_ADDRESS,
        abi: hubMintAbi,
        functionName: "stopped" as const,
        args: [i as `0x${string}`],
      })),
      allowFailure: true,
    }),
    circlesQuery({
      namespace: "V_CrcV2",
      table: "TrustRelations",
      filter: [{ column: "trustee", value: issuers, filterType: "In" }],
      limit: 20000,
    }),
  ]);

  for (const row of types) {
    const s = status.get(String(row.avatar).toLowerCase());
    if (s) s.type = avatarType(String(row.type ?? ""));
  }
  issuers.forEach((i, idx) => {
    const r = stoppedFlags[idx];
    if (r.status === "success") status.get(i)!.stopped = r.result as boolean;
  });
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  for (const row of trustRows) {
    const s = status.get(String(row.trustee).toLowerCase());
    if (s && BigInt(String(row.expiryTime ?? "0")) > nowSec) s.incomingTrusts++;
  }

  // Last personal mint, humans only — one ordered limit-1 query per issuer,
  // capped and chunked so a dusty 200-issuer wallet doesn't fire 200 queries.
  const humans = issuers
    .filter((i) => status.get(i)!.type === "human" && !status.get(i)!.stopped)
    .slice(0, LAST_MINT_CAP);
  const CHUNK = 8;
  for (let i = 0; i < humans.length; i += CHUNK) {
    await Promise.all(
      humans.slice(i, i + CHUNK).map(async (h) => {
        const rows = await circlesQuery({
          namespace: "CrcV2",
          table: "PersonalMint",
          filter: [{ column: "human", value: h }],
          order: [{ column: "blockNumber", desc: true }],
          limit: 1,
        });
        if (rows.length > 0)
          status.get(h)!.lastMint = Number(rows[0].timestamp);
      }),
    );
  }
  return status;
}

export async function fetchPortfolio(avatar: string): Promise<Portfolio> {
  const self = avatar.toLowerCase();
  const today = dayOf(Math.floor(Date.now() / 1000));
  const [balances, factors30, factors365] = await Promise.all([
    getTokenBalances(avatar),
    fetchDemurrageFactors(today + 30),
    fetchDemurrageFactors(today + 365),
  ]);

  const byIssuer = new Map<string, IssuerHolding>();
  for (const b of balances) {
    const v1 = b.version === 1;
    // v1 tokens have their own token contract per user; key the legacy bucket
    // by owner too so it groups the same way.
    const key = `${b.tokenOwner.toLowerCase()}|${v1 ? 1 : 2}`;
    let h = byIssuer.get(key);
    if (!h) {
      h = {
        owner: b.tokenOwner.toLowerCase(),
        isSelf: b.tokenOwner.toLowerCase() === self,
        v1,
        demurraged: 0n,
        staticAtto: 0n,
        wrapped: 0n,
      };
      byIssuer.set(key, h);
    }
    const demurraged = BigInt(b.attoCircles ?? "0");
    h.demurraged += demurraged;
    h.staticAtto += BigInt(b.staticAttoCircles ?? "0");
    if (b.isWrapped) h.wrapped += demurraged;
  }

  const issuers = [...byIssuer.values()].sort((a, b) =>
    b.demurraged > a.demurraged ? 1 : b.demurraged < a.demurraged ? -1 : 0,
  );

  const totals = { all: 0n, own: 0n, foreign: 0n, wrapped: 0n, v1: 0n };
  for (const h of issuers) {
    totals.all += h.demurraged;
    totals.wrapped += h.wrapped;
    if (h.v1) totals.v1 += h.demurraged;
    else if (h.isSelf) totals.own += h.demurraged;
    else totals.foreign += h.demurraged;
  }

  const status = await fetchIssuerStatus([
    ...new Set(issuers.filter((h) => !h.v1).map((h) => h.owner)),
  ]);

  return { issuers, status, totals, factors30, factors365 };
}

// Projected value of a holding at the given factors — static balance scaled by
// the Hub's own γ^day. (Demurrage burns ~7%/year of the demurraged value.)
export function projectHolding(h: IssuerHolding, f: DemurrageFactors): bigint {
  return staticToDemurraged(h.staticAtto, f);
}
