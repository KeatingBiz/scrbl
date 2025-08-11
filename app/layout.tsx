// app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import Logo from "@/components/Logo";
import TabBar from "@/components/TabBar";

export const metadata: Metadata = {
  title: "scrbl",
  description: "Snap the board. Get the steps.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-black text-white">
        {/* Top bar with logo */}
        <header className="sticky top-0 z-30 border-b border-white/10 bg-black/70 backdrop-blur supports-[backdrop-filter]:bg-black/40">
          <div className="mx-auto max-w-md px-4 h-12 flex items-center">
            <Logo size="sm" />
          </div>
        </header>

        {/* Page content */}
        <main className="pb-20"> {/* bottom padding so content doesn't hide under tab bar */}
          {children}
        </main>

        {/* Bottom tabs */}
        <TabBar />
      </body>
    </html>
  );
}

