"use client";

// Address-or-username input shared by every tool that looks something up:
// monospace field, optional "Use my avatar" shortcut when a wallet is
// connected, Enter-to-submit. Resolution to a 0x address stays with the
// caller (via resolveAddress) so each tool controls when lookups fire.
export default function AddressField({
  label,
  value,
  onChange,
  avatar,
  onEnter,
  placeholder = "0x… or a Circles name",
  disabled = false,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  avatar?: string | null;
  onEnter?: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const showMine =
    !!avatar && value.toLowerCase() !== avatar.toLowerCase() && !disabled;
  return (
    <div className={className}>
      <label className="block text-xs uppercase tracking-wide text-neutral-500">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
        placeholder={placeholder}
        disabled={disabled}
        className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-sm text-white outline-none focus:border-green-600 disabled:opacity-50"
      />
      {showMine && (
        <button
          onClick={() => onChange(avatar!)}
          className="mt-1 text-xs text-green-500 hover:text-green-400"
        >
          Use my avatar
        </button>
      )}
    </div>
  );
}
