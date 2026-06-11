/**
 * Encoding-parity check (plan verification step 4). Runs the ported
 * buildFlowMatrix against a synthetic pathfinder response and asserts the four
 * operateFlowMatrix args match what replenishMyCRC.html's generateFlowMatrixParams
 * produces for the same transfers. The reference function is inlined verbatim
 * from the HTML so this is a true byte-for-byte cross-check.
 *
 *   bun run reference/parity.test.ts
 */
import { buildFlowMatrix, encodeOperateFlowMatrix } from "../src/lib/contract";

// ── Verbatim reference (replenishMyCRC.html) ─────────────────────────────────
function packCoordinates(coordinates: number[]) {
  let packedBuffer = "0x";
  coordinates.forEach((coord) => {
    packedBuffer += coord.toString(16).padStart(4, "0");
  });
  return packedBuffer;
}

interface RefTransfer {
  from: string;
  to: string;
  tokenOwner: string;
  value: string;
}

function generateFlowMatrixParams(
  pathData: { transfers: RefTransfer[] },
  from: string,
  to: string,
  value: string,
) {
  from = from.toLowerCase();
  to = to.toLowerCase();
  const expectedValue = BigInt(value);

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

  const flowVertices = [...addrs].sort((a, b) =>
    BigInt(a) < BigInt(b) ? -1 : 1,
  );
  const lookUpMap: Record<string, number> = Object.create(null);
  flowVertices.forEach((addr, idx) => (lookUpMap[addr] = idx));

  const flowEdges = transfers.map((t) => ({
    streamSinkId: t.to === to ? 1 : 0,
    amount: BigInt(t.value),
  }));
  if (!flowEdges.some((e) => e.streamSinkId === 1)) {
    const lastIdx = transfers.map((t) => t.to).lastIndexOf(to);
    (lastIdx >= 0
      ? flowEdges[lastIdx]
      : flowEdges[flowEdges.length - 1]
    ).streamSinkId = 1;
  }
  const terminalSum = flowEdges
    .filter((e) => e.streamSinkId === 1)
    .reduce((s, e) => s + e.amount, 0n);
  if (terminalSum !== expectedValue)
    throw new Error(`terminal ${terminalSum} != ${expectedValue}`);

  const flowEdgeIds = flowEdges
    .map((e, idx) => (e.streamSinkId === 1 ? idx : -1))
    .filter((idx) => idx !== -1);
  const stream = { sourceCoordinate: lookUpMap[from], flowEdgeIds, data: "0x" };

  const coords: number[] = [];
  transfers.forEach((t) => {
    coords.push(lookUpMap[t.tokenOwner], lookUpMap[t.from], lookUpMap[t.to]);
  });

  return {
    _flowVertices: flowVertices,
    _flow: flowEdges,
    _streams: [stream],
    _packedCoordinates: packCoordinates(coords),
  };
}

// ── Sample pathfinder result (2-hop self->self replenish) ────────────────────
const A = "0x1111111111111111111111111111111111111111"; // self (source/sink)
const B = "0x2222222222222222222222222222222222222222"; // intermediary
const F = "0xffffffffffffffffffffffffffffffffffffffff"; // foreign token owner

const pathData = {
  maxFlow: "300",
  transfers: [
    { from: A, to: B, tokenOwner: F, value: "100" },
    { from: B, to: A, tokenOwner: A, value: "100" },
    { from: A, to: A, tokenOwner: A, value: "200" },
  ],
};
const VALUE = 300n; // terminal edges (to == A) sum to 100 + 200 = 300

const ref = generateFlowMatrixParams(pathData, A, A, VALUE.toString());
const mine = buildFlowMatrix(pathData, A, A, VALUE);

function eq(label: string, a: unknown, b: unknown) {
  const sa = JSON.stringify(a, (_, v) =>
    typeof v === "bigint" ? v.toString() : v,
  );
  const sb = JSON.stringify(b, (_, v) =>
    typeof v === "bigint" ? v.toString() : v,
  );
  if (sa !== sb) {
    console.error(`MISMATCH ${label}\n  ref:  ${sa}\n  mine: ${sb}`);
    process.exit(1);
  }
  console.log(`ok   ${label}`);
}

eq("flowVertices", ref._flowVertices, mine.flowVertices);
eq("flow", ref._flow, mine.flow);
eq(
  "streams",
  ref._streams,
  mine.streams.map((s) => ({
    sourceCoordinate: s.sourceCoordinate,
    flowEdgeIds: s.flowEdgeIds,
    data: s.data,
  })),
);
eq("packedCoordinates", ref._packedCoordinates, mine.packedCoordinates);

// And the encoded calldata round-trips through viem without throwing.
const data = encodeOperateFlowMatrix(mine);
if (!data.startsWith("0x") || data.length < 10) {
  console.error("bad calldata", data);
  process.exit(1);
}
console.log(
  `ok   encodeOperateFlowMatrix -> ${data.slice(0, 10)}… (${data.length} chars)`,
);
console.log("\nPARITY OK");
