'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Heart, History, Star, ClipboardList, FileText, Search, LayoutDashboard } from 'lucide-react';
import UserMenu from '@/components/user-menu';
import ThemeToggle from '@/components/theme-toggle';

const NAV_LINKS = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, match: (p: string) => p === '/' },
  { href: '/search', label: 'New Search', icon: Search, match: (p: string) => p.startsWith('/search') },
  { href: '/saved', label: 'Searches', icon: History, match: (p: string) => p.startsWith('/saved') || p.startsWith('/results') },
  { href: '/shortlisted', label: 'Shortlisted', icon: Star, match: (p: string) => p.startsWith('/shortlisted') },
  { href: '/applications', label: 'Applications', icon: ClipboardList, match: (p: string) => p.startsWith('/applications') },
  { href: '/documents', label: 'Documents', icon: FileText, match: (p: string) => p.startsWith('/documents') },
] as const;

/** Pages shown to signed-out visitors — no app navigation there. */
const AUTH_PAGES = ['/login', '/signup', '/invite'];

export function Logo({ size = 'md', compact = false }: {
  size?: 'sm' | 'md';
  /** Hide the wordmark on phones (used in the nav when the links need the room). */
  compact?: boolean;
}) {
  const box = size === 'sm' ? 'w-6 h-6 rounded-md' : 'w-8 h-8 rounded-lg';
  const icon = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';
  return (
    <span className="flex items-center gap-2.5">
      <span className={`${box} bg-gradient-to-br from-teal-600 to-emerald-600 flex items-center justify-center shadow-sm shadow-teal-500/20`}>
        <Heart className={`${icon} text-white`} aria-hidden />
      </span>
      <span className={`font-bold text-stone-800 dark:text-zinc-100 tracking-tight font-display ${size === 'sm' ? 'text-sm' : compact ? 'hidden sm:inline' : ''}`}>
        Grant<span className="text-teal-600 dark:text-teal-400">Search</span>
      </span>
    </span>
  );
}

export default function AppNav() {
  const pathname = usePathname();
  const onAuthPage = AUTH_PAGES.some(p => pathname.startsWith(p));

  return (
    <nav
      aria-label="Main"
      className="sticky top-0 z-50 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md border-b border-stone-200 dark:border-zinc-800"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-2">
        <Link href={onAuthPage ? '/login' : '/'} aria-label="GrantSearch home" className="shrink-0">
          <Logo compact={!onAuthPage} />
        </Link>

        <div className="flex items-center gap-0.5 sm:gap-1 min-w-0">
          {!onAuthPage && NAV_LINKS.map(({ href, label, icon: Icon, match }) => {
            const active = match(pathname);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                title={label}
                className={`flex items-center gap-1.5 text-sm font-medium p-2 xl:px-3 xl:py-2 rounded-lg transition-colors ${
                  active
                    ? 'bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300'
                    : 'text-stone-500 dark:text-zinc-400 hover:bg-stone-100 dark:hover:bg-zinc-800 hover:text-stone-800 dark:hover:text-zinc-200'
                }`}
              >
                <Icon className="w-4 h-4 xl:w-3.5 xl:h-3.5" aria-hidden />
                <span className="sr-only xl:not-sr-only">{label}</span>
              </Link>
            );
          })}
          {!onAuthPage && <div className="w-px h-6 bg-stone-200 dark:bg-zinc-700 mx-1 hidden sm:block" aria-hidden />}
          <ThemeToggle />
          {!onAuthPage && <UserMenu />}
        </div>
      </div>
    </nav>
  );
}
