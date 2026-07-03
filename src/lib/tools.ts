// Single source of truth for the tool index and nav. Adding a new CirclesTools
// utility = one entry here + one page under src/app/<id>/.
export type ToolStatus = "live" | "planned";

export interface Tool {
  id: string;
  title: string;
  href: string;
  blurb: string;
  status: ToolStatus;
}

// Mint, Replenish and Trust Score are hidden from the UI at the Gnosis team's
// request (they conflict with the Gnosis app's own flows). Their routes and
// lib logic remain — the pages still work by direct URL.
export const TOOLS: Tool[] = [
  {
    id: "portfolio",
    title: "Portfolio",
    href: "/portfolio",
    blurb:
      "All your CRC by issuer, with demurrage projections and dead-issuer flags.",
    status: "live",
  },
  {
    id: "doctor",
    title: "Payment Doctor",
    href: "/doctor",
    blurb:
      "Diagnose why a CRC payment won't route: max transferable amount, and which trusts would widen the corridor.",
    status: "live",
  },
  {
    id: "invite",
    title: "Invite",
    href: "/invite",
    blurb:
      "Invite someone into Circles, track outstanding invites, and see who registered through you.",
    status: "live",
  },
  {
    id: "holders",
    title: "Token Holders",
    href: "/holders",
    blurb:
      "Who holds a Circles token and how concentrated it is — defaults to your own.",
    status: "live",
  },
  {
    id: "converter",
    title: "CRC Converter",
    href: "/converter",
    blurb:
      "Convert between demurraged CRC and static (inflationary) ERC20 units, exactly as the Hub computes them.",
    status: "live",
  },
  // ── Roadmap (waves 2–4) ────────────────────────────────────────────────────
  {
    id: "checker",
    title: "Profile Checker",
    href: "/checker",
    blurb:
      "Deep-inspect any avatar: v1/v2 state, full trust ledger (incl. expired), balances, migration estimate.",
    status: "planned",
  },
  {
    id: "history",
    title: "Profile History",
    href: "/history",
    blurb:
      "Every version of a profile's metadata — view, diff, and restore an older one.",
    status: "planned",
  },
  {
    id: "safe",
    title: "Safe Inspector",
    href: "/safe",
    blurb:
      "Which keys control your avatar Safe: owners, threshold, nonce, approvals.",
    status: "planned",
  },
  {
    id: "groups",
    title: "Group Checker",
    href: "/groups",
    blurb:
      "Browse Circles groups: owner, treasury, supplies, members, market price.",
    status: "planned",
  },
  {
    id: "group-buy",
    title: "Group Buy",
    href: "/group-buy",
    blurb:
      "Mint group tokens from the CRC you hold, or top up via a swap for the rest.",
    status: "planned",
  },
  {
    id: "group-create",
    title: "Group Creator",
    href: "/group-create",
    blurb: "Deploy a new group currency with you as owner.",
    status: "planned",
  },
  {
    id: "group-admin",
    title: "Group Management",
    href: "/group-admin",
    blurb:
      "Owner console for your groups: members, service, handlers — batched.",
    status: "planned",
  },
  {
    id: "backing",
    title: "Backing Factory",
    href: "/backing",
    blurb:
      "Collateralize personal CRC with WBTC/WETH/GNO/sDAI in a year-locked LBP.",
    status: "planned",
  },
  {
    id: "lottery",
    title: "Lottery",
    href: "/lottery",
    blurb: "Join (or run) a CRC lottery — tickets paid in trusted Circles.",
    status: "planned",
  },
  {
    id: "market",
    title: "Marketplace",
    href: "/market",
    blurb: "Browse offers in the Circles marketplace.",
    status: "planned",
  },
  {
    id: "trust-graph",
    title: "Trust Graph",
    href: "/trust-graph",
    blurb: "Explore the trust network around any avatar, visually.",
    status: "planned",
  },
];
