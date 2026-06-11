import Link from "next/link";
import type { Tool } from "@/lib/tools";

export default function ToolCard({ tool }: { tool: Tool }) {
  const planned = tool.status === "planned";

  const inner = (
    <div
      className={`h-full rounded-xl border border-neutral-800 bg-neutral-900/60 p-5 transition-colors ${
        planned ? "opacity-50" : "hover:border-green-600 hover:bg-neutral-900"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-white">{tool.title}</h2>
        {planned && (
          <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs font-medium text-neutral-400">
            soon
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-neutral-400">{tool.blurb}</p>
    </div>
  );

  if (planned) return inner;
  return (
    <Link href={tool.href} className="block">
      {inner}
    </Link>
  );
}
