"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TOOLS } from "@/lib/tools";

export default function ToolNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap items-center justify-center gap-2 pt-4">
      <Link
        href="/"
        className={`px-4 py-1.5 rounded text-sm font-semibold transition-colors ${
          pathname === "/"
            ? "bg-green-600 text-white"
            : "bg-neutral-800 text-neutral-400 hover:text-white"
        }`}
      >
        Tools
      </Link>
      {TOOLS.filter((t) => t.status === "live").map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.id}
            href={t.href}
            className={`px-4 py-1.5 rounded text-sm font-semibold transition-colors ${
              active
                ? "bg-green-600 text-white"
                : "bg-neutral-800 text-neutral-400 hover:text-white"
            }`}
          >
            {t.title}
          </Link>
        );
      })}
    </nav>
  );
}
