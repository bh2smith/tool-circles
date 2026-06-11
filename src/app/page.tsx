import ToolCard from "@/components/ToolCard";
import { TOOLS } from "@/lib/tools";

export default function Home() {
  return (
    <main className="flex-1 px-4 py-8">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-bold text-white">Circles Tools</h1>
        <p className="mt-2 text-sm text-neutral-400">
          A toolbox of Circles utilities. Open inside the Circles wallet and
          your avatar signs directly — no private key required.
        </p>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {TOOLS.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      </div>
    </main>
  );
}
