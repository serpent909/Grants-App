'use client';

import { useState, useRef, useEffect, useSyncExternalStore } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { LogOut, Settings, ChevronDown } from 'lucide-react';
import Link from 'next/link';

const INITIAL_KEY = 'user-initial';
const noopSubscribe = () => () => {};

function readCachedInitial(): string {
  try { return localStorage.getItem(INITIAL_KEY) ?? ''; } catch { return ''; }
}

export default function UserMenu() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Last known initial, so the avatar doesn't flash empty while the session loads.
  const cachedInitial = useSyncExternalStore(noopSubscribe, readCachedInitial, () => '');

  const name = session?.user?.name || session?.user?.email || '';
  const email = session?.user?.email || '';
  const orgName = session?.user?.orgName || '';
  const initial = name ? name.charAt(0).toUpperCase() : cachedInitial;

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  // Cache the initial whenever the session updates
  useEffect(() => {
    if (!name) return;
    try { localStorage.setItem(INITIAL_KEY, name.charAt(0).toUpperCase()); } catch { /* ignore */ }
  }, [name]);

  if (status === 'unauthenticated') return null;

  function handleSignOut() {
    // Clear this user's cached data, but keep device preferences such as the theme.
    try {
      localStorage.removeItem(INITIAL_KEY);
      sessionStorage.clear();
    } catch { /* ignore */ }
    signOut({ callbackUrl: '/login' });
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex items-center gap-1.5 p-1.5 rounded-lg text-stone-500 dark:text-zinc-400 hover:bg-stone-100 dark:hover:bg-zinc-800 transition-colors"
      >
        <span className="w-7 h-7 bg-teal-600 rounded-full flex items-center justify-center text-white text-xs font-semibold">
          {initial}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-60 bg-white dark:bg-zinc-800 rounded-xl shadow-lg ring-1 ring-zinc-200 dark:ring-zinc-700 py-1 z-50 animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="px-3 py-2.5 border-b border-zinc-100 dark:border-zinc-700">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{name}</p>
            {email && email !== name && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{email}</p>
            )}
            {orgName && (
              <p className="text-xs text-teal-700 dark:text-teal-400 truncate mt-0.5">{orgName}</p>
            )}
          </div>

          <div className="py-1">
            <Link
              href="/settings"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
            >
              <Settings className="w-4 h-4" aria-hidden />
              Settings
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={handleSignOut}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
            >
              <LogOut className="w-4 h-4" aria-hidden />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
