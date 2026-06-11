# Plan: Circles Tools — a standalone Circles Mini App

## Context

`word-circle/scripts/` holds two headless, private-key CLI ports of
[koeppelmann/CirclesTools](https://github.com/koeppelmann/CirclesTools) utilities:
`replenish-crc.ts` (a port of `replenishMyCRC.html`) and `record-game.ts`. They run
with a Safe owner's `PRIVATE_KEY` via `@circles-sdk/adapter-safe`'s
`SafeSdkPrivateKeyContractRunner`, because off-chain there is no way to drive a Safe
without a key.

Inside a Circles **mini app** that constraint disappears: the connected avatar _is_
the Safe, and `@aboutcircles/miniapp-sdk`'s `sendTransactions([...])` makes the
Circles wallet execute calls **as the Safe** (msg.sender == avatar) — no private key
in the app at all. So these tools can become a browser UI that anyone can use with
their own wallet, instead of a script only the key-holder can run.

**Goal:** a new standalone mini app (`circles-tools`) whose first tool is **Replenish
CRC**, scaffolded with a tool-registry so the other CirclesTools utilities can be
added later. (Decisions captured via Q&A: _standalone repo_ · _Replenish CRC first_ ·
_rewrite in React/TS reusing viem + libs_.)

The crux is Replenish: the mini-app SDK exposes no signer, so we cannot use the
`@circles-sdk` `avatar.transfer()` path the script uses. Instead we port
`replenishMyCRC.html`'s **raw** approach — `circlesV2_findPath` JSON-RPC →
build flow-matrix params → encode `Hub.operateFlowMatrix` calldata →
`sendTransactions([{ to: HUB, data }])`.

## Reference: how Replenish works (source of truth = `replenishMyCRC.html`)

A "replenish" is a self→self transitive transfer constrained to settle in your own
personal token, which converts foreign CRC you hold back into fresh personal CRC.

1. **Find path** — POST `https://rpc.aboutcircles.com/`:
   ```json
   { "jsonrpc":"2.0","id":0,"method":"circlesV2_findPath",
     "params":[{ "Source":<avatar>, "Sink":<avatar>,
                 "TargetFlow":<atto amount or a large default>,
                 "WithWrap":true, "ToTokens":[<avatar>] }] }
   ```
   `ToTokens:[self]` forces the pathfinder to route foreign CRC back into your token
   (without it a self→self query is degenerate and returns 0). Response gives
   `maxFlow` and a `transfers: [{from,to,tokenOwner,value}]` list.
2. **Build flow-matrix params** — port `generateFlowMatrixParams()`:
   - `_flowVertices`: unique addresses from transfers, **strictly ascending by numeric
     value** (BigInt(address) compare).
   - `_flow`: per transfer `{ streamSinkId: (t.to === sink) ? 1 : 0, amount: BigInt(t.value) }`
     (terminal edges that reach the sink get `streamSinkId = 1`).
   - `_streams`: a single `{ sourceCoordinate: indexOf(source), flowEdgeIds: [<terminal edge indices>], data: 0x }`.
   - `_packedCoordinates`: for each transfer the triple
     `(indexOf(tokenOwner), indexOf(from), indexOf(to))`, each as a big-endian uint16,
     concatenated into a single bytes blob.
3. **Submit** — `Hub.operateFlowMatrix(_flowVertices, _flow, _streams, _packedCoordinates)`
   on `HUB_ADDRESS` (`0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8`), value 0. Must be
   sent **by the avatar** → exactly what `sendTransactions` does.

The existing `scripts/replenish-crc.ts` header comments document the same semantics
and are a good prose reference; the _encoding_ must come from the HTML (the script
delegates encoding to the SDK).

## Repo scaffold (`circles-tools`, mirrors `word-circle`)

New repo. Stack copied from word-circle: Next.js 16 App Router, React 19, Tailwind 4,
viem, `@aboutcircles/miniapp-sdk`, run with **bun**.

Copy verbatim (then trim): `tsconfig.json` (incl. `@/* → ./src/*` paths),
`bunfig.toml` (`minimumReleaseAge`), `postcss.config.mjs`, `eslint.config.mjs`,
`next.config.ts`, `.prettierignore`, package scripts (`dev/build/start/lint/fmt`).
`package.json` deps: `@aboutcircles/miniapp-sdk`, `viem`, `next`, `react`,
`react-dom`. (Drop `@circles-sdk/*` — not needed in-browser.)

```
circles-tools/
  src/
    app/
      layout.tsx          # mirror word-circle layout: dark #121213, Geist fonts, <ToolNav/>
      globals.css
      page.tsx            # tool index (cards driven by the registry)
      replenish/page.tsx  # first tool (client)
    components/
      ToolNav.tsx         # top nav (mirror ModeNav)
      ConnectGate.tsx     # "open in Circles wallet" / shows connected avatar
      ToolCard.tsx        # index card
    lib/
      circles.ts          # trimmed copy of word-circle/src/lib/circles.ts
      contract.ts         # trimmed copy + flow-matrix helpers
      tools.ts            # tool registry (id, title, blurb, href, status)
```

## Shared lib

**`src/lib/circles.ts`** — copy from `word-circle/src/lib/circles.ts`; **keep**
`isMiniappMode`, `initCircles`, `subscribeWallet`, `getConnectedAddress`,
`fetchCirclesProfiles`, `circlesProfileUrl`, and a thin `sendTransactions` re-export.
Update `CIRCLES_MINIAPP_URL` to the new slug (e.g.
`https://circles.gnosis.io/miniapps/circles-tools`). **Drop** all PvP code
(`joinPvpGame`, `NoCirclesError`, `submitGameResult`).

**`src/lib/contract.ts`** — copy `HUB_ADDRESS` + the viem `publicClient`
(`createPublicClient({ chain: gnosis, transport: http() })`). **Add**:

- `hubFlowAbi = parseAbi(["function operateFlowMatrix((address[] _flowVertices, (uint16 streamSinkId, uint192 amount)[] _flow, (uint16 sourceCoordinate, uint16[] flowEdgeIds, bytes data)[] _streams, bytes packedCoordinates))"])`
  — confirm the exact tuple shape against the on-chain Hub ABI before coding.
- `findPath(source, sink, targetFlow)` → fetch wrapper over `circlesV2_findPath`.
- `buildFlowMatrix(transfers, source, sink)` → returns `{ flowVertices, flow, streams, packedCoordinates }` (the ported `generateFlowMatrixParams`).
- `encodeOperateFlowMatrix(params)` → `encodeFunctionData(...)`.
  Drop word-circle's stats/PvP/escrow encoders.

**`src/lib/tools.ts`** — registry array so the index page and nav render from one
source and new tools are one entry + one page:

```ts
export const TOOLS = [
  {
    id: "replenish",
    title: "Replenish CRC",
    href: "/replenish",
    blurb: "Convert foreign CRC you hold back into fresh personal CRC.",
    status: "live",
  },
  // future: { id:"record", ... status:"planned" }, profile/converter/safe-viewer ...
];
```

## Replenish tool — `src/app/replenish/page.tsx` (client)

1. `initCircles()` on mount; `subscribeWallet(setAvatar)`. If not in miniapp mode /
   no avatar → render `<ConnectGate/>` (deep-link to `CIRCLES_MINIAPP_URL`).
2. On load (and on avatar change) call `findPath(avatar, avatar, LARGE_DEFAULT)` to
   show **max replenishable** (`maxFlow`, formatted from atto via `viem.formatEther`).
3. Amount input (default = max; clamp requested ≤ max), mirroring the script's CLI
   arg. Convert CRC→atto with `viem.parseEther`.
4. **Preview** (the script's `DRY_RUN`): show resolved amount + transfer/edge count.
5. **Replenish** button → `findPath` at the chosen amount → `buildFlowMatrix` →
   `encodeOperateFlowMatrix` → `sendTransactions([{ to: HUB_ADDRESS, data, value:"0x0" }])`.
   Show submitted hash + Gnosisscan link; handle `maxFlow == 0` ("nothing to
   replenish") and errors with a toast.

## Mini-app registration & deploy

- Deploy to Vercel (new project). The mini app loads inside the Circles wallet via an
  iframe/registry slug — register `circles-tools` in the Circles mini-app registry
  (same mechanism word-circle uses for `word-circles`); set `CIRCLES_MINIAPP_URL`
  accordingly. **Confirm the registration path with the Circles team / repo docs** —
  this is the one externally-dependent step.
- No backend/env required for v1 (Replenish is fully client-side against public RPC).

## Verification

1. `bun install && bun run dev`; open `/` → tool index shows the Replenish card;
   `/replenish` renders.
2. **Outside** a wallet: `isMiniappMode()` false → `ConnectGate` shown (no crash).
3. **Read path (no wallet needed):** temporarily hardcode a known avatar holding
   foreign CRC, call `findPath` from a small script/`bun repl`, and assert
   `maxFlow > 0` and a non-empty `transfers` array — validates RPC wiring.
4. **Encoding parity (key check):** for a sample pathfinder response, compare
   `buildFlowMatrix` + `encodeOperateFlowMatrix` output byte-for-byte against the
   calldata the original `replenishMyCRC.html` produces for the same transfers
   (open the HTML, log its `params` and the ethers-encoded data). They must match.
5. **End-to-end:** open the deployed app inside the Circles wallet with a test avatar,
   Preview, then Replenish; confirm the wallet prompts an `operateFlowMatrix` tx from
   the avatar and it lands (Gnosisscan), and personal CRC balance increases.
6. Lint/format: `bun run lint && bun run fmt:check`.

## Out of scope (registry-ready for later)

Record Game (port of `record-game.ts`; encoders already trivial), and read-only
viewers — Profile Checker, CRC Converter, Safe Viewer, Group Checker — each becomes
one `TOOLS` entry + one page reusing `publicClient` / `fetchCirclesProfiles`.
