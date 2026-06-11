"use client";

import { CIRCLES_MINIAPP_URL } from "@/lib/circles";

// Shown when the app is opened outside the Circles wallet (no host SDK / no
// connected avatar). There is no signer here, so the only action is to deep-link
// into the Circles wallet where the avatar can drive transactions.
export default function ConnectGate() {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-neutral-800 bg-neutral-900/60 p-6 text-center">
      <h2 className="text-lg font-semibold text-white">
        Open in the Circles wallet
      </h2>
      <p className="mt-2 text-sm text-neutral-400">
        Circles Tools runs as a mini app inside the Circles wallet, where your
        avatar signs transactions directly. Open it there to continue.
      </p>
      <a
        href={CIRCLES_MINIAPP_URL}
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-block rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-500"
      >
        Open in Circles
      </a>
    </div>
  );
}
