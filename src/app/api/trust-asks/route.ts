import { NextResponse } from "next/server";

// "Who to ask to trust you" — the highest-leverage way to raise an incoming-based
// Backers score is to get Backers who currently reach you at hop 2 to trust you
// *directly* (hop 1). A backer B is at hop 2 when B trusts some X who trusts you.
// We compute that set here (a 2-hop expansion of the trust graph) and rank it by
// how many shared intermediaries you have with each backer — the warmest asks.
//
// Done server-side because it fans out across the whole trust graph: one query
// for the Backers set, your direct trusters, your outgoing trusts, then a batched
// `In` query for everyone who trusts your trusters.

const RPC = "https://rpc.aboutcircles.com/";
const BACKERS_GROUP = "0x1aca75e38263c79d9d4f10df0635cc6fcfe6f026";
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
// Cap on how many of your direct trusters we expand through, to bound the fan-out
// for very heavily-trusted avatars. The omission is reported back to the client.
const MAX_INTERMEDIARIES = 1500;
const CHUNK = 200;

interface QueryResult {
  columns: string[];
  rows: unknown[][];
}

async function circlesQuery(
  table: string,
  filter: Record<string, unknown>[],
): Promise<QueryResult> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "circles_query",
      params: [
        {
          Namespace: "V_CrcV2",
          Table: table,
          Filter: filter,
          Limit: 100000,
        },
      ],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message ?? "circles_query failed");
  return data.result as QueryResult;
}

// Active (non-expired) values of `col` from a TrustRelations result.
function activeValues(r: QueryResult, col: string, nowSec: bigint): string[] {
  const ci = r.columns.indexOf(col);
  const ei = r.columns.indexOf("expiryTime");
  const out: string[] = [];
  for (const row of r.rows) {
    if (BigInt(String(row[ei] ?? "0")) > nowSec) {
      out.push(String(row[ci]).toLowerCase());
    }
  }
  return out;
}

export async function POST(req: Request) {
  let avatar: string | undefined;
  try {
    avatar = (await req.json())?.avatar;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof avatar !== "string" || !ADDRESS_RE.test(avatar)) {
    return NextResponse.json(
      { error: "invalid avatar address" },
      { status: 400 },
    );
  }
  const me = avatar.toLowerCase();
  const nowSec = BigInt(Math.floor(Date.now() / 1000));

  try {
    // 1. Backers set
    const bm = await circlesQuery("GroupMemberships", [
      {
        Type: "FilterPredicate",
        FilterType: "Equals",
        Column: "group",
        Value: BACKERS_GROUP,
      },
    ]);
    const mi = bm.columns.indexOf("member");
    const backers = new Set(bm.rows.map((r) => String(r[mi]).toLowerCase()));

    // 2. Your active direct trusters (the hop-1 intermediaries) and your
    //    outgoing trusts (to flag reciprocation).
    const [incRes, outRes] = await Promise.all([
      circlesQuery("TrustRelations", [
        {
          Type: "FilterPredicate",
          FilterType: "Equals",
          Column: "trustee",
          Value: me,
        },
      ]),
      circlesQuery("TrustRelations", [
        {
          Type: "FilterPredicate",
          FilterType: "Equals",
          Column: "truster",
          Value: me,
        },
      ]),
    ]);
    const directTrusters = [
      ...new Set(activeValues(incRes, "truster", nowSec)),
    ];
    const youTrust = new Set(activeValues(outRes, "trustee", nowSec));
    const hop1Backers = new Set(directTrusters.filter((a) => backers.has(a)));

    const intermediaries = directTrusters.slice(0, MAX_INTERMEDIARIES);
    const truncated = directTrusters.length > MAX_INTERMEDIARIES;

    // 3. Everyone who trusts your trusters, batched. For each backer that shows
    //    up, count distinct shared intermediaries (= mutual connections).
    const shared = new Map<string, Set<string>>();
    for (let i = 0; i < intermediaries.length; i += CHUNK) {
      const chunk = intermediaries.slice(i, i + CHUNK);
      const r = await circlesQuery("TrustRelations", [
        {
          Type: "FilterPredicate",
          FilterType: "In",
          Column: "trustee",
          Value: chunk,
        },
      ]);
      const tri = r.columns.indexOf("truster");
      const tei = r.columns.indexOf("trustee");
      const exi = r.columns.indexOf("expiryTime");
      for (const row of r.rows) {
        if (BigInt(String(row[exi] ?? "0")) <= nowSec) continue;
        const b = String(row[tri]).toLowerCase();
        if (!backers.has(b) || hop1Backers.has(b) || b === me) continue;
        const x = String(row[tei]).toLowerCase();
        let set = shared.get(b);
        if (!set) shared.set(b, (set = new Set()));
        set.add(x);
      }
    }

    const candidates = [...shared.entries()]
      .map(([address, set]) => ({
        address,
        sharedIntermediaries: set.size,
        youTrust: youTrust.has(address),
      }))
      .sort(
        (a, b) =>
          b.sharedIntermediaries - a.sharedIntermediaries ||
          (a.address < b.address ? -1 : 1),
      )
      .slice(0, 50);

    return NextResponse.json({
      totalBackers: backers.size,
      hop1Backers: hop1Backers.size,
      hop2Backers: shared.size,
      candidates,
      truncated,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "computation failed" },
      { status: 502 },
    );
  }
}
