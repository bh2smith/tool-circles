"use client";

import {
  isMiniappMode,
  onWalletChange,
  sendTransactions,
  type Transaction,
} from "@aboutcircles/miniapp-sdk";
import { getAddress } from "viem";

export { isMiniappMode, sendTransactions };
export type { Transaction };

// Deep-link target shown by the ConnectGate when the app is opened outside the
// Circles wallet. Update the slug once the app is registered in the registry.
export const CIRCLES_MINIAPP_URL =
  "https://circles.gnosis.io/miniapps/circles-tools";

// Official, public Circles Explorer profile page (profile, balances, trust
// relations, bot classification). Client-rendered SPA.
export function circlesProfileUrl(address: string): string {
  return `https://explorer.aboutcircles.com/avatar/${address}`;
}

export type WalletListener = (address: string | null) => void;

const listeners: Set<WalletListener> = new Set();
let currentAddress: string | null = null;
let initialized = false;

// Subscribe to the host wallet exactly once. `onWalletChange` fires immediately
// with the current state and again on every change; we checksum the address and
// fan it out to component subscribers.
export function initCircles() {
  if (initialized) return;
  initialized = true;

  if (!isMiniappMode()) return;

  onWalletChange((address: string | null) => {
    try {
      currentAddress = address ? getAddress(address) : null;
    } catch {
      currentAddress = null;
    }
    listeners.forEach((fn) => fn(currentAddress));
  });
}

export function subscribeWallet(fn: WalletListener): () => void {
  listeners.add(fn);
  fn(currentAddress);
  return () => listeners.delete(fn);
}

export function getConnectedAddress(): string | null {
  return currentAddress;
}

export interface CirclesProfile {
  name: string;
  address: string;
  previewImageUrl: string | null;
}

const profileCache = new Map<string, CirclesProfile>();

const PROFILES_API = "https://rpc.aboutcircles.com/profiles/search/addresses";

export async function fetchCirclesProfiles(
  addresses: string[],
): Promise<Map<string, CirclesProfile>> {
  const uncached = addresses.filter((a) => !profileCache.has(a.toLowerCase()));
  if (uncached.length > 0) {
    try {
      const res = await fetch(PROFILES_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addresses: uncached, fetchComplete: true }),
      });
      if (res.ok) {
        const profiles: CirclesProfile[] = await res.json();
        for (const p of profiles) {
          profileCache.set(p.address.toLowerCase(), p);
        }
      }
    } catch {
      // profiles are best-effort; fall back to truncated addresses
    }
  }
  const result = new Map<string, CirclesProfile>();
  for (const a of addresses) {
    const cached = profileCache.get(a.toLowerCase());
    if (cached) result.set(a.toLowerCase(), cached);
  }
  return result;
}

const PROFILE_SEARCH_API = "https://rpc.aboutcircles.com/profiles/search";

// Resolve a username to its avatar address (first match), or return the input
// unchanged if it is already a 0x address. Returns null when nothing matches.
export async function resolveAddress(input: string): Promise<string | null> {
  const q = input.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(q)) {
    try {
      return getAddress(q);
    } catch {
      return null;
    }
  }
  try {
    const res = await fetch(
      `${PROFILE_SEARCH_API}?name=${encodeURIComponent(q)}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const profiles = Array.isArray(data) ? data : (data?.data ?? []);
    const addr = profiles[0]?.address;
    return addr && /^0x[a-fA-F0-9]{40}$/.test(addr) ? getAddress(addr) : null;
  } catch {
    return null;
  }
}
