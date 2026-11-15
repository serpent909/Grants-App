import type { Metadata, Viewport } from "next";
import { Inter, DM_Sans } from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import Providers from "./providers";
import AppNav, { Logo } from "@/components/app-nav";
import VerifyEmailBanner from "@/components/verify-email-banner";
import { headers } from "next/headers";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const dmSans = DM_Sans({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "GrantSearch — Find the Right Grants for Your Organisation",
    template: "%s · GrantSearch",
  },
  description: "Find and rank the best grants for your organisation. We search hundreds of government, foundation, corporate, and community funding sources.",
  // The app is entirely behind a login — keep it out of search indexes.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#18181b" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="en-NZ" suppressHydrationWarning>
      <head>
        {/* Deliberately synchronous: it must set the theme class before first
            paint to avoid a light/dark flash. It is a tiny same-origin file. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme.js" nonce={nonce} suppressHydrationWarning />
      </head>
      <body className={`${inter.variable} ${dmSans.variable} font-sans antialiased bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100`}>
        <Providers>
          <TooltipProvider>
            <a
              href="#main"
              className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-teal-600 focus:text-white focus:text-sm focus:font-semibold"
            >
              Skip to content
            </a>

            <AppNav />
            <VerifyEmailBanner />

            <main id="main">{children}</main>

            <footer className="border-t border-stone-200 dark:border-zinc-800 bg-stone-50 dark:bg-zinc-900">
              <div className="max-w-7xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
                <Logo size="sm" />
                <p className="text-xs text-stone-500 dark:text-zinc-500 text-center sm:text-right">
                  Match scores are AI-generated estimates. Always verify grant details directly with funders before applying.
                </p>
              </div>
            </footer>
          </TooltipProvider>
        </Providers>
      </body>
    </html>
  );
}
