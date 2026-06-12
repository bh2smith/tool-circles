import {
  getTokenBalances,
  HUB_ADDRESS,
  hubAvatarsAbi,
  publicClient,
} from "./contract";
import { circlesQuery } from "./query";
import { fetchOutgoingTrusts } from "./trust";

// Inviting in Circles v2 is trust-then-register: the inviter trusts the
// invitee's (not yet registered) address; when the invitee calls
// registerHuman(inviter, …) from their own wallet, INVITATION_COST is burned
// from the inviter's personal CRC — at registration time, not now — and the
// invitee receives the welcome bonus. There is no inviteHuman() on the Hub.

export const INVITATION_COST = 96n * 10n ** 18n;
export const WELCOME_BONUS = 48n * 10n ** 18n;

const ZERO = "0x0000000000000000000000000000000000000000";

export interface Invitee {
  address: string;
  timestamp: number; // registration time
}

// Avatars this account has successfully invited (they registered).
export async function fetchInvitees(avatar: string): Promise<Invitee[]> {
  const rows = await circlesQuery({
    namespace: "V_CrcV2",
    table: "Avatars",
    filter: [{ column: "invitedBy", value: avatar.toLowerCase() }],
    order: [{ column: "blockNumber", desc: true }],
    limit: 1000,
  });
  return rows.map((r) => ({
    address: String(r.avatar).toLowerCase(),
    timestamp: Number(r.timestamp),
  }));
}

async function registeredFlags(addresses: string[]): Promise<boolean[]> {
  if (addresses.length === 0) return [];
  const results = await publicClient.multicall({
    contracts: addresses.map((a) => ({
      address: HUB_ADDRESS,
      abi: hubAvatarsAbi,
      functionName: "avatars" as const,
      args: [a as `0x${string}`],
    })),
    allowFailure: true,
  });
  return results.map((r) => r.status === "success" && r.result !== ZERO);
}

export async function isRegistered(address: string): Promise<boolean> {
  const [flag] = await registeredFlags([address]);
  return flag;
}

// Outstanding invites = addresses the avatar trusts that never registered.
// (Trusting an unregistered address is exactly what extends an invitation.)
export async function fetchPendingInvites(avatar: string): Promise<string[]> {
  const trustees = await fetchOutgoingTrusts(avatar);
  const flags = await registeredFlags(trustees);
  return trustees.filter((_, i) => !flags[i]);
}

// The inviter's own-token balance — what the 96 CRC burn draws from.
export async function fetchPersonalBalance(avatar: string): Promise<bigint> {
  const balances = await getTokenBalances(avatar);
  const self = avatar.toLowerCase();
  return balances
    .filter((b) => b.version === 2 && b.tokenOwner.toLowerCase() === self)
    .reduce((s, b) => s + BigInt(b.attoCircles ?? "0"), 0n);
}
