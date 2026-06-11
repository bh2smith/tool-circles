# Circles Tools

A standalone [Circles](https://aboutcircles.com) **mini app** — a browser toolbox
of CirclesTools utilities. Opened inside the Circles wallet, the connected avatar
_is_ the Safe, so transactions execute **as the avatar** (`msg.sender == avatar`)
via [`@aboutcircles/miniapp-sdk`](https://docs.aboutcircles.com)'s
`sendTransactions` — no private key in the app.

The first tool is **Replenish CRC**: a self→self transitive transfer constrained
to settle in your own personal token, which converts foreign CRC you hold back
into fresh personal CRC. It's a browser port of
[koeppelmann/CirclesTools `replenishMyCRC.html`](https://github.com/koeppelmann/CirclesTools).

## How Replenish works

1. **Find path** — `circlesV2_findPath` (POST `https://rpc.aboutcircles.com/`)
   with `Source == Sink == avatar`, `WithWrap: true`, and `ToTokens: [avatar]`.
   `ToTokens:[self]` forces the pathfinder to route foreign CRC back into your
   token; without it a self→self query is degenerate and returns 0.
2. **Build flow matrix** — port of `generateFlowMatrixParams()`: ascending
   `_flowVertices`, per-edge `streamSinkId`, one `_streams` entry, and
   big-endian `uint16` `_packedCoordinates`. See `src/lib/contract.ts`.
3. **Submit** — `Hub.operateFlowMatrix(...)` on the v2 Hub
   (`0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8`), sent by the avatar.

## Stack

Next.js 16 (App Router) · React 19 · Tailwind 4 · viem · `@aboutcircles/miniapp-sdk`.
Run with [bun](https://bun.sh).

```bash
bun install
bun run dev          # http://localhost:3000
bun run build        # production build + typecheck
bun run lint
bun run fmt:check
```

## Layout

```
src/
  app/
    layout.tsx            # dark shell + <ToolNav/>
    page.tsx              # tool index (cards from the registry)
    replenish/page.tsx    # Replenish CRC tool (client)
  components/             # ToolNav, ToolCard, ConnectGate, Toast
  lib/
    circles.ts            # miniapp-sdk wiring: wallet subscribe, sendTransactions
    contract.ts           # findPath + buildFlowMatrix + encodeOperateFlowMatrix
    tools.ts              # tool registry — add a tool = one entry + one page
reference/               # not compiled into the app
    replenish-crc.ts     # the original headless / private-key port (prose reference)
    parity.test.ts       # byte-for-byte encoding cross-check vs the reference HTML
```

## Verification

- `bun run reference/parity.test.ts` — asserts `buildFlowMatrix` matches the
  original HTML's `generateFlowMatrixParams` byte-for-byte (the key encoding check).
- `bun run build && bun run lint` — typecheck + lint.

## Registration & deploy (the one external step)

Deploy to Vercel (new project), then register the slug in the Circles mini-app
registry — the same mechanism `word-circles` uses — and update
`CIRCLES_MINIAPP_URL` in `src/lib/circles.ts` to match. Confirm the registration
path with the Circles team. No backend or env is required: Replenish is fully
client-side against the public RPC.

## Adding tools

Each remaining CirclesTools utility (Record Game, Profile Checker, CRC Converter,
Safe Viewer, …) is one entry in `src/lib/tools.ts` + one page under `src/app/<id>/`.
