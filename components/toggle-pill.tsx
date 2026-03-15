'use client';

export function TogglePill({ label, selected, onToggle }: {
  label: string; selected: boolean; onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`px-3.5 py-1.5 rounded-full text-[13px] font-medium border transition-all duration-150 ${
        selected
          ? 'bg-teal-50 border-teal-400 text-teal-800 shadow-sm'
          : 'bg-white border-zinc-300 text-zinc-600 hover:border-zinc-400 hover:text-zinc-800'
      }`}
    >
      {label}
    </button>
  );
}
