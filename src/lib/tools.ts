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
  // Future ports (registry-ready):
  // { id: "record", title: "Record Game", href: "/record", blurb: "...", status: "planned" },
  // { id: "profile", title: "Profile Checker", href: "/profile", blurb: "...", status: "planned" },
  // { id: "converter", title: "CRC Converter", href: "/converter", blurb: "...", status: "planned" },
];
