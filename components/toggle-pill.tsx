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
          ? 'bg-teal-50 dark:bg-teal-950 border-teal-400 dark:border-teal-600 text-teal-800 dark:text-teal-300 shadow-sm'
          : 'bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-400 hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
      }`}
    >
      {label}
    </button>
  );
}
