'use client';

import { useState, useRef, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { LogOut, Settings, ChevronDown } from 'lucide-react';
import Link from 'next/link';

export default function UserMenu() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!session?.user) return null;

  const user = session.user as Record<string, unknown>;
  const name = (user.name as string) || (user.email as string) || 'User';
  const orgName = (user.orgName as string) || '';
  const initial = name.charAt(0).toUpperCase();

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 p-1.5 rounded-lg text-stone-500 hover:bg-stone-100 transition-colors"
      >
        <div className="w-7 h-7 bg-teal-600 rounded-full flex items-center justify-center text-white text-xs font-semibold">
          {initial}
        </div>
        <ChevronDown className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-xl shadow-lg ring-1 ring-zinc-200 py-1 z-50">
          <div className="px-3 py-2.5 border-b border-zinc-100">
            <p className="text-sm font-medium text-zinc-900 truncate">{name}</p>
            {orgName && (
              <p className="text-xs text-zinc-500 truncate">{orgName}</p>
            )}
          </div>

          <div className="py-1">
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 transition-colors"
            >
              <Settings className="w-4 h-4" />
              Settings
            </Link>
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
