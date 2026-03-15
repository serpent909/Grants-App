import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { Heart, Bookmark } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GrantSearch — Free Grant Finder for Nonprofits",
  description: "Find the right grants for your nonprofit or charity. Free, no sign-up needed. We search hundreds of government, foundation, corporate, and community funding sources.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} antialiased bg-white text-zinc-900`}>
        <TooltipProvider>
          <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-stone-200">
            <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
              <Link
                href="/"
                className="flex items-center gap-2.5 group"
              >
                <div className="w-8 h-8 bg-gradient-to-br from-teal-600 to-emerald-600 rounded-lg flex items-center justify-center shadow-sm shadow-teal-500/20">
                  <Heart className="w-4 h-4 text-white" />
                </div>
                <span className="font-semibold text-stone-800 tracking-tight">
                  Grant<span className="text-teal-600">Search</span>
                </span>
              </Link>
              <div className="flex items-center gap-2">
                <span className="hidden md:block text-sm text-stone-400 font-normal mr-4">
                  Free for nonprofits
                </span>
                <Link
                  href="/saved"
                  className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg text-stone-500 hover:bg-stone-100 transition-colors"
                >
                  <Bookmark className="w-3.5 h-3.5" />
                  Saved
                </Link>
                <Link
                  href="/"
                  className="text-sm font-medium px-4 py-2 rounded-lg text-teal-600 hover:bg-teal-50 transition-colors"
                >
                  New Search
                </Link>
              </div>
            </div>
          </nav>

          <main>{children}</main>

          <footer className="border-t border-stone-200 bg-stone-50">
            <div className="max-w-7xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <div className="w-6 h-6 bg-gradient-to-br from-teal-600 to-emerald-600 rounded-md flex items-center justify-center">
                  <Heart className="w-3 h-3 text-white" />
                </div>
                <span className="text-sm font-medium text-stone-500">GrantSearch</span>
              </div>
              <p className="text-xs text-stone-400 text-center sm:text-right">
                Match scores are estimates only. Always verify grant details directly with funders before applying.
              </p>
            </div>
          </footer>
        </TooltipProvider>
      </body>
    </html>
  );
}
