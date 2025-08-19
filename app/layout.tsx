// app/layout.tsx
import "./globals.css";
import type { Metadata, Viewport } from "next";
import React from "react";
import Link from "next/link";
import Logo from "@/components/Logo";
import TabBar from "@/components/TabBar";

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
          <header className="sticky top-0 z-40 border-b border-white/10 bg-black/60 supports-[backdrop-filter]:bg-black/40 backdrop-blur">
            <div className="px-4 py-3 relative">
              {/* Left & right (in normal flow) */}
              <div className="flex items-center justify-between">
                {/* Left: existing logo */}
                <Logo size="sm" href="/" />

                {/* Right: profile icon inside a circle */}
                <Link
                  href="/account"
                  className="w-9 h-9 grid place-items-center rounded-full border border-white/15 hover:bg-white/5 transition"
                  aria-label="Profile"
                  title="Profile"
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                    <path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Zm0 2c-5 0-9 2.5-9 5.5V22h18v-2.5C21 16.5 17 14 12 14Z" />
                  </svg>
                </Link>
              </div>

              {/* Centered brand name (clickable) */}
              <div className="absolute inset-0 grid place-items-center pointer-events-none">
                <Link
                  href="/"
                  className="pointer-events-auto text-green-500 font-bold text-lg lowercase"
                  aria-label="Go to homepage"
                  title="scrbl"
                >
                  scrbl
                </Link>
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
