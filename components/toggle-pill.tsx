'use client';

export function TogglePill({ label, selected, onToggle }: {
  label: string; selected: boolean; onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-150 ${
        selected
          ? 'bg-teal-50 border-teal-300 text-teal-700'
          : 'bg-white border-zinc-200 text-zinc-500 hover:border-zinc-300 hover:text-zinc-700'
      }`}
    >
      {label}
    </button>
  );
}
