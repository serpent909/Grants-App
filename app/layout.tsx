import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { Search } from "lucide-react";
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
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} antialiased bg-slate-50 text-slate-900`}>
        <TooltipProvider>
          {/* Navigation */}
          <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur border-b border-slate-200 shadow-sm">
            <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
              <Link href="/" className="flex items-center gap-2 font-bold text-slate-900 hover:opacity-80 transition-opacity">
                <div className="w-7 h-7 bg-gradient-to-br from-blue-600 to-teal-600 rounded-lg flex items-center justify-center">
                  <Search className="w-3.5 h-3.5 text-white" />
                </div>
                <span>Grant<span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-teal-600">Search</span></span>
              </Link>
              <div className="flex items-center gap-4 text-sm text-slate-500">
                <span className="hidden sm:block">AI-powered grant discovery</span>
                <Link
                  href="/"
                  className="px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 font-medium hover:bg-blue-100 transition-colors"
                >
                  New Search
                </Link>
              </div>
            </div>
          </nav>

          {/* Main Content */}
          <main>{children}</main>

          {/* Footer */}
          <footer className="border-t border-slate-200 bg-white mt-16">
            <div className="max-w-7xl mx-auto px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-slate-400">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 bg-gradient-to-br from-blue-600 to-teal-600 rounded flex items-center justify-center">
                  <Search className="w-2.5 h-2.5 text-white" />
                </div>
                <span>GrantSearch — AI-powered grant discovery</span>
              </div>
              <p>Scores are AI estimates only. Verify all details with funders before applying.</p>
            </div>
          </footer>
        </TooltipProvider>
      </body>
    </html>
  );
}
