import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GrantSearch — AI-Powered Grant Finder",
  description: "Find the most relevant grants for your non-profit. AI-powered search and scoring across government, foundation, corporate, and community funding sources.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} antialiased bg-white text-zinc-900`}>
        <TooltipProvider>
          <nav className="sticky top-0 z-50 bg-[#0c0c1e]/95 backdrop-blur-sm border-b border-white/8">
            <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
              <Link
                href="/"
                className="flex items-center gap-2.5 group"
              >
                <div className="w-8 h-8 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-lg flex items-center justify-center shadow-sm shadow-indigo-500/30">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <span className="font-semibold text-white tracking-tight">
                  Grant<span className="text-indigo-400">Search</span>
                </span>
              </Link>
              <div className="flex items-center gap-6">
                <span className="hidden md:block text-sm text-zinc-500 font-normal">
                  AI-powered grant discovery
                </span>
                <Link
                  href="/"
                  className="text-sm font-medium px-4 py-2 rounded-lg text-indigo-400 hover:bg-indigo-500/10 transition-colors"
                >
                  New Search
                </Link>
              </div>
            </div>
          </nav>

          <main>{children}</main>

          <footer className="border-t border-white/8 bg-[#0c0c1e]">
            <div className="max-w-7xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <div className="w-6 h-6 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-md flex items-center justify-center">
                  <Sparkles className="w-3 h-3 text-white" />
                </div>
                <span className="text-sm font-medium text-zinc-500">GrantSearch</span>
              </div>
              <p className="text-xs text-zinc-600 text-center sm:text-right">
                Scores are AI estimates only. Always verify grant details directly with funders before applying.
              </p>
            </div>
          </footer>
        </TooltipProvider>
      </body>
    </html>
  );
}
