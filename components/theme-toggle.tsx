'use client';

import { Moon, Sun, Monitor } from 'lucide-react';
import { useTheme } from '@/components/theme-provider';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

export default function ThemeToggle() {
  const { resolvedTheme, setTheme, theme, mounted } = useTheme();

  function cycle() {
    if (theme === 'light') setTheme('dark');
    else if (theme === 'dark') setTheme('system');
    else setTheme('light');
  }

  // Before hydration, render a static placeholder matching the button size to prevent layout shift.
  // The FOUC script already applied the correct theme class, so use resolvedTheme from CSS.
  if (!mounted) {
    return (
      <div className="p-2 w-8 h-8">
        <Sun className="w-4 h-4 text-stone-500 dark:text-zinc-400 dark:hidden" />
        <Moon className="w-4 h-4 text-stone-500 dark:text-zinc-400 hidden dark:block" />
      </div>
    );
  }

  const Icon = theme === 'dark' ? Moon : theme === 'system' ? Monitor : Sun;
  const label = theme === 'dark' ? 'Dark' : theme === 'system' ? 'System' : 'Light';

  return (
    <Tooltip>
      <TooltipTrigger
        onClick={cycle}
        className="p-2 rounded-lg text-stone-500 dark:text-zinc-400 hover:bg-stone-100 dark:hover:bg-zinc-800 transition-colors"
      >
        <Icon className="w-4 h-4" />
      </TooltipTrigger>
      <TooltipContent>Theme: {label}</TooltipContent>
    </Tooltip>
  );
}
