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
