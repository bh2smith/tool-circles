import { createPublicClient, encodeFunctionData, http, parseAbi } from "viem";
import { gnosis } from "viem/chains";

// Circles v2 Hub. `operateFlowMatrix` settles a transitive transfer described by
// a flow matrix; it must be sent *by the avatar* (the Safe is msg.sender), which
// is exactly what the mini-app `sendTransactions` does.
export const HUB_ADDRESS =
  "0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8" as const;

// Pathfinder JSON-RPC. Routes the transitive transfer and returns the concrete
// per-token transfer edges we encode into the flow matrix.
export const CIRCLES_RPC = "https://rpc.aboutcircles.com/";

export const publicClient = createPublicClient({
  chain: gnosis,
  transport: http(),
});

// operateFlowMatrix takes FOUR separate arguments (not one wrapping tuple):
//   address[] _flowVertices,
//   FlowEdge[] _flow            = (uint16 streamSinkId, uint192 amount)[]
//   Stream[] _streams           = (uint16 sourceCoordinate, uint16[] flowEdgeIds, bytes data)[]
//   bytes _packedCoordinates
// Shape confirmed byte-for-byte against the on-chain Hub ABI in replenishMyCRC.html.
export const hubFlowAbi = parseAbi([
  "function operateFlowMatrix(address[] _flowVertices, (uint16 streamSinkId, uint192 amount)[] _flow, (uint16 sourceCoordinate, uint16[] flowEdgeIds, bytes data)[] _streams, bytes _packedCoordinates)",
]);

// ── Pathfinder ───────────────────────────────────────────────────────────────

export interface PathTransfer {
  from: string;
  to: string;
  tokenOwner: string;
  value: string; // atto-CRC, decimal string
}

export interface PathData {
  maxFlow: string; // atto-CRC, decimal string
  transfers: PathTransfer[];
}

// A "replenish" is a self -> self transitive transfer constrained to settle in
// your own personal token (`ToTokens: [self]`), which forces the pathfinder to
// route foreign CRC you hold back into fresh personal CRC. Without that, a
// source==sink query is degenerate and returns 0. Mirrors replenishMyCRC.html.
export async function findPath(
  source: string,
  sink: string,
  targetFlow: bigint,
): Promise<PathData> {
  const res = await fetch(CIRCLES_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 0,
      method: "circlesV2_findPath",
      params: [
        {
          Source: source,
          Sink: sink,
          TargetFlow: targetFlow.toString(),
          WithWrap: true,
          ToTokens: [sink],
        },
      ],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message ?? "pathfinder error");
  return data.result as PathData;
}

// ── Flow-matrix encoding (port of generateFlowMatrixParams) ──────────────────

export interface FlowEdge {
  streamSinkId: number;
  amount: bigint;
}

export interface Stream {
  sourceCoordinate: number;
  flowEdgeIds: number[];
  data: `0x${string}`;
}

export interface FlowMatrix {
  flowVertices: `0x${string}`[];
  flow: FlowEdge[];
  streams: Stream[];
  packedCoordinates: `0x${string}`;
}

// Build the four operateFlowMatrix arguments from a pathfinder result. `value` is
// the requested flow in atto-CRC and MUST equal the sum of the terminal edges the
// pathfinder returned for that target — so always call findPath with the same
// amount you pass here (do not reuse a max-probe path). Ported 1:1 from the
// reference HTML so the calldata matches byte-for-byte.
export function buildFlowMatrix(
  pathData: PathData,
  from: string,
  to: string,
  value: bigint,
): FlowMatrix {
  if (!pathData?.transfers?.length)
    throw new Error("Pathfinder returned no transfers");

  from = from.toLowerCase();
  to = to.toLowerCase();

  // 1. normalise transfers + collect all addresses
  const addrs = new Set<string>([from, to]);
  const transfers = pathData.transfers.map((t) => {
    const norm = {
      from: t.from.toLowerCase(),
      to: t.to.toLowerCase(),
      tokenOwner: t.tokenOwner.toLowerCase(),
      value: t.value,
    };
    addrs.add(norm.from);
    addrs.add(norm.to);
    addrs.add(norm.tokenOwner);
    return norm;
  });

  // 2. strictly-ascending vertices (numeric compare on the address)
  const flowVertices = [...addrs].sort((a, b) =>
    BigInt(a) < BigInt(b) ? -1 : 1,
  );
  const lookUp: Record<string, number> = Object.create(null);
  flowVertices.forEach((addr, idx) => (lookUp[addr] = idx));

  // 3. flow edges; only edges that reach the sink are terminal (streamSinkId = 1)
  const flow: FlowEdge[] = transfers.map((t) => ({
    streamSinkId: t.to === to ? 1 : 0,
    amount: BigInt(t.value),
  }));
  if (!flow.some((e) => e.streamSinkId === 1)) {
    const lastIdx = transfers.map((t) => t.to).lastIndexOf(to);
    (lastIdx >= 0 ? flow[lastIdx] : flow[flow.length - 1]).streamSinkId = 1;
  }

  // verify sum(terminal amounts) == requested value
  const terminalSum = flow
    .filter((e) => e.streamSinkId === 1)
    .reduce((s, e) => s + e.amount, 0n);
  if (terminalSum !== value)
    throw new Error(`terminal amount ${terminalSum} != requested ${value}`);

  // 4. one stream referencing every terminal edge
  const flowEdgeIds = flow
    .map((e, idx) => (e.streamSinkId === 1 ? idx : -1))
    .filter((idx) => idx !== -1);
  const streams: Stream[] = [
    { sourceCoordinate: lookUp[from], flowEdgeIds, data: "0x" },
  ];

  // 5. coordinate triples (tokenOwner, from, to) packed big-endian uint16
  const coords: number[] = [];
  transfers.forEach((t) => {
    coords.push(lookUp[t.tokenOwner], lookUp[t.from], lookUp[t.to]);
  });
  const packedCoordinates = ("0x" +
    coords
      .map((c) => c.toString(16).padStart(4, "0"))
      .join("")) as `0x${string}`;

  return {
    flowVertices: flowVertices as `0x${string}`[],
    flow,
    streams,
    packedCoordinates,
  };
}

export function encodeOperateFlowMatrix(m: FlowMatrix): `0x${string}` {
  return encodeFunctionData({
    abi: hubFlowAbi,
    functionName: "operateFlowMatrix",
    args: [m.flowVertices, m.flow, m.streams, m.packedCoordinates],
  });
}

// ── Wrapped (ERC20) balances ─────────────────────────────────────────────────

// `operateFlowMatrix` settles ERC1155 Circles, whose tokenOwner must be a
// registered avatar. But with `WithWrap: true` the pathfinder happily routes
// ERC20-wrapped balances you hold, and reports those edges' `tokenOwner` as the
// *wrapper contract* (e.g. a `CrcV2_ERC20WrapperDeployed_Inflationary` token) —
// which is not an avatar. Submitted as-is, the Hub reverts with
// `CirclesErrorOneAddressArg(wrapper, 0x24)` (code 36 = avatar must be
// registered). See https://github.com/bh2smith/tool-circles/issues/1.
//
// So we do what `@circles-sdk`'s `transitiveTransfer` does: unwrap the wrappers
// the path spends, rewrite those edges' tokenOwner to the underlying avatar, run
// operateFlowMatrix over the all-avatar path, then re-wrap any inflationary
// leftover. The official SDK also prepends a self-`setApprovalForAll`; we omit it
// because here the operator, source and sink are all the avatar (the Safe is
// msg.sender), which operateFlowMatrix already permits — the non-wrapped path has
// always worked without one.

const WRAPPER_PREFIX = "CrcV2_ERC20WrapperDeployed";
// Hub.wrap(_avatar, _amount, _type) — CirclesType { Demurrage = 0, Inflation = 1 }.
const CIRCLES_TYPE_INFLATION = 1;

// A row from `circles_getTokenBalances` (only the fields we consume). Crucially it
// carries BOTH the demurraged (`attoCircles`, today's value) and the static
// (`staticAttoCircles`) balance, so we never have to do demurrage math ourselves.
export interface TokenBalance {
  tokenAddress: string; // wrapper contract address (for wrapped tokens)
  tokenOwner: string; // the underlying registered avatar
  tokenType: string; // e.g. "CrcV2_ERC20WrapperDeployed_Inflationary"
  attoCircles: string; // demurraged balance, atto, decimal string
  staticAttoCircles: string; // static (inflationary) balance, atto
  isWrapped: boolean;
  isInflationary: boolean;
  isGroup: boolean;
  version: number; // 1 = legacy Circles, 2 = current Hub
}

export async function getTokenBalances(
  avatar: string,
): Promise<TokenBalance[]> {
  const res = await fetch(CIRCLES_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 0,
      method: "circles_getTokenBalances",
      params: [avatar],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message ?? "balances error");
  return (data.result ?? []) as TokenBalance[];
}

// Hub.wrap re-wraps unwrapped Circles back into their ERC20 form.
export const hubWrapAbi = parseAbi([
  "function wrap(address _avatar, uint256 _amount, uint8 _type) returns (address)",
]);
// The ERC20 wrapper itself: unwrap burns the ERC20 and credits the caller the
// underlying ERC1155 Circles. `_amount` is in the wrapper's own units — static
// for inflationary wrappers, demurraged for demurraged ones.
export const erc20WrapperAbi = parseAbi(["function unwrap(uint256 _amount)"]);

export interface BatchTx {
  to: string;
  data: `0x${string}`;
  value: string;
}

// Build the ordered transaction batch for a replenish, transparently handling any
// ERC20-wrapped foreign balances the path spends. Returns the txs plus the final
// flow-matrix vertices (so the caller can fail-fast verify they're all registered
// avatars). For a path with no wrapped edges this is just the single
// operateFlowMatrix call — identical to the pre-fix behaviour.
export function buildReplenishBatch(
  path: PathData,
  balances: TokenBalance[],
  avatar: string,
  value: bigint,
): { txs: BatchTx[]; matrix: FlowMatrix } {
  avatar = avatar.toLowerCase();

  // wrapper contract address -> underlying avatar + balances
  const wrappers = new Map<
    string,
    {
      owner: string;
      inflationary: boolean;
      staticAtto: bigint;
      demurragedAtto: bigint;
    }
  >();
  for (const b of balances) {
    const isWrapper =
      b.isWrapped || (b.tokenType ?? "").startsWith(WRAPPER_PREFIX);
    if (!isWrapper) continue;
    wrappers.set(b.tokenAddress.toLowerCase(), {
      owner: b.tokenOwner.toLowerCase(),
      inflationary:
        b.isInflationary || (b.tokenType ?? "").endsWith("Inflationary"),
      staticAtto: BigInt(b.staticAttoCircles ?? "0"),
      demurragedAtto: BigInt(b.attoCircles ?? "0"),
    });
  }

  // Demurraged amount the path spends per wrapper — sum of edges leaving the
  // avatar that settle in that wrapper's token. (Pathfinder values are demurraged.)
  const usedByWrapper = new Map<string, bigint>();
  for (const t of path.transfers) {
    const owner = t.tokenOwner.toLowerCase();
    if (t.from.toLowerCase() === avatar && wrappers.has(owner)) {
      usedByWrapper.set(
        owner,
        (usedByWrapper.get(owner) ?? 0n) + BigInt(t.value),
      );
    }
  }

  const unwraps: BatchTx[] = [];
  const rewraps: BatchTx[] = [];
  for (const [wrapperAddr, used] of usedByWrapper) {
    const w = wrappers.get(wrapperAddr)!;
    // Inflationary: unwrap the entire static balance (avoids static<->demurraged
    // rounding short-falls), then re-wrap the leftover. Demurraged: unwrap exactly
    // what the path needs, nothing to re-wrap.
    const unwrapAmount = w.inflationary ? w.staticAtto : used;
    unwraps.push({
      to: wrapperAddr,
      data: encodeFunctionData({
        abi: erc20WrapperAbi,
        functionName: "unwrap",
        args: [unwrapAmount],
      }),
      value: "0x0",
    });
    if (w.inflationary) {
      const leftover = w.demurragedAtto - used;
      if (leftover > 0n) {
        rewraps.push({
          to: HUB_ADDRESS,
          data: encodeFunctionData({
            abi: hubWrapAbi,
            functionName: "wrap",
            args: [w.owner as `0x${string}`, leftover, CIRCLES_TYPE_INFLATION],
          }),
          value: "0x0",
        });
      }
    }
  }

  // Rewrite wrapper tokenOwners -> underlying avatar, then build the flow matrix
  // over the all-avatar path. Amounts (incl. the terminal sum) are unchanged.
  const rewritten: PathData = {
    maxFlow: path.maxFlow,
    transfers: path.transfers.map((t) => {
      const w = wrappers.get(t.tokenOwner.toLowerCase());
      return w ? { ...t, tokenOwner: w.owner } : t;
    }),
  };
  const matrix = buildFlowMatrix(rewritten, avatar, avatar, value);
  const operate: BatchTx = {
    to: HUB_ADDRESS,
    data: encodeOperateFlowMatrix(matrix),
    value: "0x0",
  };

  return { txs: [...unwraps, operate, ...rewraps], matrix };
}

export const hubAvatarsAbi = parseAbi([
  "function avatars(address) view returns (address)",
]);

// Fail fast with a clear message if any flow vertex is not a registered avatar —
// instead of letting operateFlowMatrix revert with the opaque code-36 error. This
// is a safety net for any wrapped/unknown token owner the rewrite above didn't
// resolve. One multicall against the Hub.
export async function assertVerticesRegistered(
  vertices: `0x${string}`[],
): Promise<void> {
  const ZERO = "0x0000000000000000000000000000000000000000";
  const results = await publicClient.multicall({
    contracts: vertices.map((v) => ({
      address: HUB_ADDRESS,
      abi: hubAvatarsAbi,
      functionName: "avatars" as const,
      args: [v],
    })),
    allowFailure: true,
  });
  const bad = vertices.filter((_, i) => {
    const r = results[i];
    return r.status !== "success" || r.result === ZERO;
  });
  if (bad.length) {
    throw new Error(
      `Pathfinder returned ${bad.length} token owner(s) that are not registered ` +
        `Circles avatars (${bad.join(", ")}). A wrapped balance likely could not ` +
        `be resolved — please report this.`,
    );
  }
}

// ── Trust ────────────────────────────────────────────────────────────────────

// Hub.trust(receiver, expiry): the caller (avatar) trusts `receiver` until
// `expiry`. Trust is directional and set by the truster, so the avatar can only
// change its own outgoing edges. Matches @circles-sdk: trust = max-uint96 expiry
// (never expires), untrust = expiry 0.
export const hubTrustAbi = parseAbi([
  "function trust(address _trustReceiver, uint96 _expiry)",
]);

const NEVER_EXPIRES = 79228162514264337593543950335n; // max uint96

export function encodeTrust(trustee: string): `0x${string}` {
  return encodeFunctionData({
    abi: hubTrustAbi,
    functionName: "trust",
    args: [trustee as `0x${string}`, NEVER_EXPIRES],
  });
}

// Revoke trust by setting expiry to 0 (exactly what avatar.untrust does).
export function encodeUntrust(trustee: string): `0x${string}` {
  return encodeFunctionData({
    abi: hubTrustAbi,
    functionName: "trust",
    args: [trustee as `0x${string}`, 0n],
  });
}
