import { formatEther } from "viem";
import { circlesQuery } from "./query";

// Holder distribution of one Circles token. In v2 a personal or group token's
// address IS the issuing avatar's address, so "who holds my CRC" is just a
// lookup of the connected avatar. One indexer query, no contracts.

export interface TokenHolder {
  account: string;
  demurraged: bigint; // atto-CRC, today's value
  lastActivity: number; // unix sec
}

export interface TokenDistribution {
  holders: TokenHolder[]; // descending by balance
  total: bigint;
}

export async function fetchTokenHolders(
  tokenAddress: string,
): Promise<TokenDistribution> {
  const rows = await circlesQuery({
    namespace: "V_CrcV2",
    table: "BalancesByAccountAndToken",
    filter: [{ column: "tokenAddress", value: tokenAddress.toLowerCase() }],
    order: [{ column: "demurragedTotalBalance", desc: true }],
    limit: 10000,
  });
  const holders = rows
    .map((r) => ({
      account: String(r.account).toLowerCase(),
      demurraged: BigInt(String(r.demurragedTotalBalance ?? "0")),
      lastActivity: Number(r.lastActivity ?? 0),
    }))
    .filter((h) => h.demurraged > 0n)
    // Re-sort locally — bigint-safe even if the server ordered lexically.
    .sort((a, b) =>
      b.demurraged > a.demurraged ? 1 : b.demurraged < a.demurraged ? -1 : 0,
    );
  const total = holders.reduce((s, h) => s + h.demurraged, 0n);
  return { holders, total };
}

// share of `part` in `whole`, in basis points — bigint-safe percentage math.
export function shareBps(part: bigint, whole: bigint): number {
  if (whole === 0n) return 0;
  return Number((part * 10000n) / whole);
}

export function holdersToCsv(d: TokenDistribution): string {
  const lines = ["account,balance_crc,share_pct"];
  for (const h of d.holders) {
    lines.push(
      `${h.account},${formatEther(h.demurraged)},${(shareBps(h.demurraged, d.total) / 100).toFixed(2)}`,
    );
  }
  return lines.join("\n");
}
