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

export const TOOLS: Tool[] = [
  {
    id: "replenish",
    title: "Replenish CRC",
    href: "/replenish",
    blurb: "Convert foreign CRC you hold back into fresh personal CRC.",
    status: "live",
  },
  {
    id: "trust",
    title: "Trust Score",
    href: "/trust",
    blurb:
      "Check any account's Backers trust score, and prune sybils from your trust list.",
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
    id: "converter",
    title: "CRC Converter",
    href: "/converter",
    blurb:
      "Convert between demurraged CRC and static (inflationary) ERC20 units, exactly as the Hub computes them.",
    status: "live",
  },
  // Future ports (registry-ready):
  // { id: "record", title: "Record Game", href: "/record", blurb: "...", status: "planned" },
];
