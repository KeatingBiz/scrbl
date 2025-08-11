// components/Logo.tsx
"use client";
import Image from "next/image";
import Link from "next/link";

type Size = "sm" | "md" | "lg";

const px: Record<Size, number> = {
  sm: 28,   // header
  md: 40,   // general small badges, etc.
  lg: 96,   // hero on Scrbl tab
};

export default function Logo({
  size = "md",
  href = "/",
  glow = true,
}: {
  size?: Size;
  href?: string | null; // set to null/undefined to render non-clickable
  glow?: boolean;
}) {
  const w = px[size];
  const img = (
    <Image
      src="/scrbl.png"   // place your image at /public/scrbl.png
      width={w}
      height={w}
      alt="SCRBL"
      priority={size !== "sm"}
      className={glow ? "select-none drop-shadow-[0_0_12px_rgba(57,255,20,0.45)]" : "select-none"}
    />
  );

  if (!href) return img;
  return (
    <Link href={href} aria-label="Home" className="inline-flex items-center">
      {img}
    </Link>
  );
}


