import type { Metadata } from "next";
import { Inter, DM_Sans } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { Heart, History, Star, ClipboardList, FileText } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import Providers from "./providers";
import UserMenu from "@/components/user-menu";

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
  title: "GrantSearch — Find the Right Grants for Your Organisation",
  description: "Find and rank the best grants for your organisation. We search hundreds of government, foundation, corporate, and community funding sources.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${dmSans.variable} font-sans antialiased bg-white text-zinc-900`}>
        <Providers>
        <TooltipProvider>
          <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-stone-200">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
              <Link
                href="/"
                className="flex items-center gap-2.5 group"
              >
                <div className="w-8 h-8 bg-gradient-to-br from-teal-600 to-emerald-600 rounded-lg flex items-center justify-center shadow-sm shadow-teal-500/20">
                  <Heart className="w-4 h-4 text-white" />
                </div>
                <span className="font-bold text-stone-800 tracking-tight font-display">
                  Grant<span className="text-teal-600">Search</span>
                </span>
              </Link>
              <div className="flex items-center gap-1 sm:gap-2">
                <Link
                  href="/saved"
                  className="flex items-center gap-1.5 text-sm font-medium p-2 sm:px-4 sm:py-2 rounded-lg text-stone-500 hover:bg-stone-100 transition-colors"
                  title="Funding Searches"
                >
                  <History className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                  <span className="hidden sm:inline">Funding Searches</span>
                </Link>
                <Link
                  href="/shortlisted"
                  className="flex items-center gap-1.5 text-sm font-medium p-2 sm:px-4 sm:py-2 rounded-lg text-stone-500 hover:bg-stone-100 transition-colors"
                  title="Shortlisted"
                >
                  <Star className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                  <span className="hidden sm:inline">Shortlisted</span>
                </Link>
                <Link
                  href="/applications"
                  className="flex items-center gap-1.5 text-sm font-medium p-2 sm:px-4 sm:py-2 rounded-lg text-stone-500 hover:bg-stone-100 transition-colors"
                  title="Applications"
                >
                  <ClipboardList className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                  <span className="hidden sm:inline">Applications</span>
                </Link>
                <Link
                  href="/documents"
                  className="flex items-center gap-1.5 text-sm font-medium p-2 sm:px-4 sm:py-2 rounded-lg text-stone-500 hover:bg-stone-100 transition-colors"
                  title="Documents"
                >
                  <FileText className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                  <span className="hidden sm:inline">Documents</span>
                </Link>
                <div className="w-px h-6 bg-stone-200 mx-1 hidden sm:block" />
                <UserMenu />
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
        </Providers>
      </body>
    </html>
  );
}
