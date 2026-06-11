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

export function circlesProfileUrl(address: string): string {
  return `https://app.gnosis.io/${address}`;
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
