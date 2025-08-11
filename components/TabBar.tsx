// components/TabBar.tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const tabs = [
  { href: "/", label: "Scrbl" },
  { href: "/gallery", label: "Gallery" },
  { href: "/calendar", label: "Calendar" },
];

export default function TabBar() {
  const pathname = usePathname() || "/";
  return (
    <nav className="fixed bottom-0 left-0 right-0 border-t border-white/10 bg-black/70 backdrop-blur supports-[backdrop-filter]:bg-black/40">
      <div className="mx-auto max-w-md grid grid-cols-3">
        {tabs.map(t => {
          const active = pathname === t.href || (t.href !== "/" && pathname.startsWith(t.href));
          return (
            <Link
              key={t.href}
              href={t.href}
              className={clsx(
                "py-3 text-center text-sm", 
                active ? "text-scrbl font-semibold" : "text-neutral-300 hover:text-white"
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
