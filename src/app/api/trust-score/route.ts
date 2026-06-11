import { NextResponse } from "next/server";

// Proxy to the Circles advanced-analytics relative-trust-score endpoint. We go
// through the server so the call is same-origin (no CORS dependence on the
// analytics host — the likely reason the original github.io tool fails) and the
// "all_backers" target set is pinned here rather than reassembled client-side.
const ANALYTICS_API =
  "https://squid-app-3gxnl.ondigitalocean.app/aboutcircles-advanced-analytics2";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { avatars, includeDetails } = (body ?? {}) as {
    avatars?: unknown;
    includeDetails?: unknown;
  };

  if (!Array.isArray(avatars) || avatars.length === 0) {
    return NextResponse.json(
      { error: "avatars must be a non-empty array" },
      { status: 400 },
    );
  }
  const cleaned = avatars
    .filter((a): a is string => typeof a === "string" && ADDRESS_RE.test(a))
    .map((a) => a.toLowerCase());
  if (cleaned.length === 0) {
    return NextResponse.json(
      { error: "no valid avatar addresses" },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(`${ANALYTICS_API}/scoring/relative_trustscore`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        avatars: cleaned,
        target_set_name: "all_backers",
        include_details: includeDetails === true,
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: `analytics ${res.status}`, detail: text.slice(0, 500) },
        { status: 502 },
      );
    }
    return new NextResponse(text, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "scoring request failed" },
      { status: 502 },
    );
  }
}
