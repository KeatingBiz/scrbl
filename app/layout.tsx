// app/layout.tsx
import "./globals.css";
import type { Metadata, Viewport } from "next";
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
          <header className="sticky top-0 z-40 bg-black/60 backdrop-blur supports-[backdrop-filter]:bg-black/40 border-b border-white/10">
            <div className="px-4 py-3">
              <Logo size="sm" href="/" />
            </div>
          </header>

          <main className="pb-20">{children}</main>

          <TabBar />
        </div>
      </body>
    </html>
  );
}





