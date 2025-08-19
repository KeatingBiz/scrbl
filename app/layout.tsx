// app/layout.tsx
import "./globals.css";
import type { Metadata, Viewport } from "next";
import Logo from "@/components/Logo";
import TabBar from "@/components/TabBar";
import Link from "next/link";

export const metadata: Metadata = {
  title: "scrbl",
  description: "Snap the lecture whiteboard → Solve, Explain, or Schedule",
  icons: { icon: "/favicon.ico" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#000000",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-black text-white">
        <div className="min-h-screen mx-auto max-w-md relative">
          <header
            className="sticky top-0 z-40 border-b border-white/10 bg-black/60 supports-[backdrop-filter]:bg-black/40 backdrop-blur transform-gpu will-change-transform isolation-auto"
            style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" as any }}
          >
            {/* Header row */}
            <div className="px-4 py-3 relative">
              {/* Left & Right in normal flow */}
              <div className="flex items-center justify-between">
                {/* Left: your existing Logo */}
                <Logo size="sm" href="/" />

                {/* Right: profile icon links to /account */}
                <Link
                  href="/account"
                  className="p-2 rounded-lg hover:bg-white/5 transition"
                  aria-label="Profile"
                  title="Profile"
                >
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
                    <path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Zm0 2c-5 0-9 2.5-9 5.5V22h18v-2.5C21 16.5 17 14 12 14Z" />
                  </svg>
                </Link>
              </div>

              {/* Centered brand name (overlay, non-blocking) */}
              <div className="absolute inset-0 grid place-items-center pointer-events-none">
                <span className="text-green-500 font-bold text-lg lowercase">scrbl</span>
              </div>
            </div>
          </header>

          {/* isolate main content to avoid cross-paint with header during first swipe */}
          <main className="pb-20 isolation-auto">{children}</main>

          <TabBar />
        </div>
      </body>
    </html>
  );
}
