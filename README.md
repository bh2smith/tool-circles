# Circles Tools

A standalone [Circles](https://aboutcircles.com) **mini app** — a browser toolbox
of CirclesTools utilities. Opened inside the Circles wallet, the connected avatar
_is_ the Safe, so transactions execute **as the avatar** (`msg.sender == avatar`)
via [`@aboutcircles/miniapp-sdk`](https://docs.aboutcircles.com)'s
`sendTransactions` — no private key in the app.

Tools so far:

- **Replenish CRC** — a self→self transitive transfer constrained to settle in
  your own personal token, which converts foreign CRC you hold back into fresh
  personal CRC. Browser port of
  [koeppelmann/CirclesTools `replenishMyCRC.html`](https://github.com/koeppelmann/CirclesTools).
- **Trust Score** — look up any account's Backers trust score (a sybil-resistance
  proxy), with a hop-distance breakdown, and prune your own trust list by
  scoring everyone you trust and batch-untrusting weakly-connected accounts.
- **Payment Doctor** — diagnose a CRC payment corridor: the max amount that can
  route from sender to recipient right now, and which direct trusts from the
  recipient would widen it. Read-only; not a port — new to this toolbox.
- **CRC Converter** — convert between demurraged CRC and static (inflationary)
  ERC20 units at any date, delegating the math to the Hub's own `Demurrage`
  helpers via `eth_call`. Port of `crcConverter.html`.
- **Mint CRC** — claim your accrued personal CRC (1/hour, capped two weeks
  after the last mint), with an accrual-cap countdown and mint history. Not a
  port — new to this toolbox.
- **Portfolio** — every CRC holding grouped by issuer, with demurrage
  projections (+30 d / +1 y) and dead-issuer flags (stopped / idle /
  untrusted). Not a port — new to this toolbox.
- **Invite** — invite someone into Circles (trust-then-register), track
  outstanding invites, and list everyone who registered through you. Not a
  port — new to this toolbox.
- **Token Holders** — holder distribution of any Circles token (personal or
  group), with concentration stats and CSV export. Port of
  `tokenDistributionChecker.html`.

## How Replenish works

1. **Find path** — `circlesV2_findPath` (POST `https://rpc.aboutcircles.com/`)
   with `Source == Sink == avatar`, `WithWrap: true`, and `ToTokens: [avatar]`.
   `ToTokens:[self]` forces the pathfinder to route foreign CRC back into your
   token; without it a self→self query is degenerate and returns 0.
2. **Build flow matrix** — port of `generateFlowMatrixParams()`: ascending
   `_flowVertices`, per-edge `streamSinkId`, one `_streams` entry, and
   big-endian `uint16` `_packedCoordinates`. See `src/lib/contract.ts`.
3. **Handle wrapped balances** — `operateFlowMatrix` only moves ERC1155 Circles,
   whose `tokenOwner` must be a registered avatar. But with `WithWrap: true` the
   pathfinder also routes any ERC20-_wrapped_ foreign CRC you hold, reporting
   those edges' `tokenOwner` as the **wrapper contract** (not an avatar) — which
   the Hub rejects with code 36 ([#1](https://github.com/bh2smith/tool-circles/issues/1)).
   So, like `@circles-sdk`, `buildReplenishBatch` unwraps each wrapper the path
   spends (full static balance for inflationary, exact amount for demurraged),
   rewrites those edges' `tokenOwner` to the underlying avatar, and re-wraps any
   inflationary leftover — yielding a batch of `[unwrap…, operateFlowMatrix,
re-wrap…]` (just `operateFlowMatrix` when no wrapped balance is on the path).
4. **Submit** — the batch above, sent by the avatar via `sendTransactions`. The
   v2 Hub is `0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8`.

## How Trust Score works

The **Backers trust score** is a BFS over the Circles trust graph: starting from
the target avatar, it counts how many [Backers group](https://app.gnosis.io)
members are reachable within 5 hops, weighted by a per-hop decay
(1.0 / 0.9 / 0.8 / 0.6 / 0.4 / 0.2). It is **incoming-based** — it counts who
trusts _you_, transitively — which is what makes it sybil-resistant: you can't
inflate your own score by trusting others.

- **Score** — POST `…/scoring/relative_trustscore` with
  `target_set_name: "all_backers"`, proxied through `/api/trust-score` so the call
  is same-origin (no CORS dependence on the analytics host — the likely reason the
  original [`trustScoreExplorer.html`](https://aboutcircles.github.io/CirclesTools/trustScoreExplorer.html)
  fails) and the target set is pinned server-side.
- **Prune** — list the avatar's active outgoing trusts (`circles_query` on
  `TrustRelations`), score each trustee, then batch-untrust the weak ones with
  `Hub.trust(trustee, 0)` (expiry 0 = revoke, matching `@circles-sdk`'s untrust).
  This is the only trust lever the avatar controls; it curates who you vouch for
  and your token exposure, but does **not** change your own (incoming) score.

## How Payment Doctor works

Transitive payments fail opaquely: the wallet caps the amount at the corridor's
max flow with no explanation. The doctor probes
`circlesV2_findPath(Source: sender, Sink: recipient)` with a huge `TargetFlow`
(and **no** `ToTokens` pin — any token the recipient accepts may settle) to get
the true max flow, then explains it by diffing the sender's holdings
(`circles_getTokenBalances`, grouped by token owner, v2 only) against the
recipient's outgoing trusts:

- tokens the recipient trusts route **directly**;
- the rest only route while intermediaries have liquidity — each direct trust
  from the recipient is a guaranteed unlock, up to the amount held. The
  sender's own token is called out specially, since it's usually the largest
  holding.

## How the daily-driver tools work

- **Mint** — one multicall on the Hub (`calculateIssuance(avatar)`, `isHuman`,
  `stopped`) gives the claimable amount and the accrual window:
  `calculateIssuance` returns `(issuance, startPeriod, endPeriod)` where
  `startPeriod` is the last mint and `endPeriod` the last completed hour, so
  `endPeriod − startPeriod` vs `MAX_CLAIM_DURATION` (2 weeks) drives the
  cap-progress bar. Mint = `Hub.personalMint()` via `sendTransactions`;
  history = `circles_query` on `CrcV2.PersonalMint`.
- **Portfolio** — `circles_getTokenBalances` grouped by `tokenOwner` (it
  carries demurraged + static balances per row, so no math client-side).
  Projections scale each issuer's **static** balance by the Hub's own
  conversion factors fetched for `today+30` / `today+365` (see
  `src/lib/demurrage.ts`). Dead-issuer signals are batched: `Hub.stopped`
  multicall, issuer types + active incoming-trust counts via two `In`-filtered
  `circles_query` calls, and last-`PersonalMint` lookups (capped + chunked).
- **Invite** — there is no `inviteHuman` on the v2 Hub. Inviting = trusting an
  _unregistered_ address (`Hub.trust`); when the invitee calls
  `registerHuman(inviter, …)` from their own wallet, **96 CRC is burned from
  the inviter's personal tokens at that moment** (so the page checks your
  own-token balance and warns). Outstanding invites = outgoing trusts whose
  trustee has no `Hub.avatars` entry; successful ones =
  `V_CrcV2.Avatars where invitedBy == you`.
- **Token Holders** — one `circles_query` on
  `V_CrcV2.BalancesByAccountAndToken` filtered by token address (a personal or
  group token's address _is_ the issuing avatar's address). Note: ERC20-wrapped
  balances live under their wrapper's address, not the avatar's.

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
    trust/page.tsx        # Trust Score evaluator + trust-list pruning (client)
    doctor/page.tsx       # Payment Doctor corridor diagnosis (client)
    converter/page.tsx    # CRC Converter demurraged <-> static calculator (client)
    mint/page.tsx         # Mint CRC claimable dashboard (client)
    portfolio/page.tsx    # Portfolio holdings-by-issuer inspector (client)
    invite/page.tsx       # Invite flow + outstanding/successful invites (client)
    holders/page.tsx      # Token Holders distribution (client)
    api/trust-score/route.ts  # server proxy to the analytics scoring endpoint
  components/             # ToolNav, ToolCard, ConnectGate, Toast, AddressField
  lib/
    circles.ts            # miniapp-sdk wiring: wallet subscribe, sendTransactions, profiles
    contract.ts           # findPath + flow-matrix encoders + trust/untrust encoders
    query.ts              # generic circles_query client (the indexer)
    trust.ts              # score lookups, outgoing-trust listing
    doctor.ts             # corridor probe: general findPath, holdings-by-owner, trust diff
    demurrage.ts          # day index + Hub demurrage conversion factors
    mint.ts               # calculateIssuance/personalMint + mint history
    portfolio.ts          # holdings-by-issuer, projections, dead-issuer signals
    invite.ts             # invitees/pending queries + personal-balance check
    distribution.ts       # token-holder distribution query + CSV
    format.ts             # shared CRC/address/duration formatting
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

A tool is one entry in `src/lib/tools.ts` + one page under `src/app/<id>/`.
The registry already lists the roadmap (rendered as "soon" cards), distilled
from a survey of both CirclesTools repos and the Circles RPC surface:

- **Wave 2 — diagnostics**: Profile Checker (`profileChecker.html`, helper
  contract `0x6885E3e0…`), Profile History (`profileHistory.html`, NameRegistry
  `updateMetadataDigest` restore), Safe Inspector (`SafeViewer.html`, state
  half), plus a Sankey path visualization for Payment Doctor
  (`trustPathViz.html`).
- **Wave 3 — groups**: Group Checker (GroupInfoGetter `0x3cd1c2be…`), Group
  Buy (`findPath` with `ToTokens:[group]` over the existing flow-matrix
  engine — the original `groupPurchaseHelper.html` swaps the static/demurraged
  wrappers at line 1263; don't copy that), Group Creator (modernized to
  BaseGroupFactory `0xD0B5Bd99…`), Group Management (batched
  `trustBatchWithConditions`).
- **Wave 4 — economy/social**: Backing Factory (`0xecEd9123…`, CowSwap
  post-hook appData — verify the program is still live first), Lottery
  participate (`LotteryFactory 0x4B146798…`), Marketplace Explorer
  (`market-api.aboutcircles.com`), Trust Graph visualizer (`trustViz.html`).
- **Skipped on purpose**: `createLegacyCirclesSafe.html` (legacy v1 Safe
  deployer), `rpcQueryView.html` as a whole (developer IDE — its method
  catalog is still the best machine-readable RPC docs), `priceInsights.html`
  (unofficial third-party analytics API).
