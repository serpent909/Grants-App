'use client';

import { createContext, useContext, useEffect, useCallback, useSyncExternalStore } from 'react';

type Theme = 'light' | 'dark' | 'system';
type Resolved = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: Resolved;
  mounted: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  setTheme: () => {},
  resolvedTheme: 'light',
  mounted: false,
});

export const useTheme = () => useContext(ThemeContext);

// ─── External store: localStorage preference + OS colour scheme ─────────────
// Read with useSyncExternalStore so there is no setState-in-effect, and the
// preference stays in sync across tabs.

const STORAGE_KEY = 'theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';
const listeners = new Set<() => void>();

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener('change', listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    media.removeEventListener('change', listener);
    window.removeEventListener('storage', listener);
  };
}

/** Snapshot is a primitive string so React can compare it cheaply: "theme|resolved". */
function getSnapshot(): string {
  const theme = readTheme();
  const systemDark = window.matchMedia(DARK_QUERY).matches;
  const resolved: Resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
  return `${theme}|${resolved}`;
}

const SERVER_SNAPSHOT = 'system|light';
const noopSubscribe = () => () => {};

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [theme, resolvedTheme] = snapshot.split('|') as [Theme, Resolved];

  // Sync the resolved theme to the <html> class (the pre-hydration script in
  // public/theme.js sets it first to avoid a flash).
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
  }, [resolvedTheme]);

  const setTheme = useCallback((next: Theme) => {
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* storage unavailable */ }
    for (const listener of listeners) listener();
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme, mounted }}>
      {children}
    </ThemeContext.Provider>
  );
}
