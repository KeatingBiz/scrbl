// components/Logo.tsx
"use client";
import Link from "next/link";
import clsx from "clsx";

export default function Logo({ size = "md", href = "/" }: { size?: "sm" | "md" | "lg"; href?: string }) {
  const sz = size === "lg" ? "text-3xl" : size === "sm" ? "text-base" : "text-2xl";
  return (
    <Link href={href} className={clsx("inline-flex items-center gap-2 font-black tracking-tight", sz)}>
      <span className="italic" style={{ transform: "skewX(-8deg)" }}>scr</span>
      <span className="text-scrbl" style={{ transform: "skewX(-8deg)" }}>bl</span>
    </Link>
  );
}

