// components/Logo.tsx
"use client";
import Image from "next/image";
import Link from "next/link";

type Size = "sm" | "md" | "lg";

// bumped up all sizes
const px: Record<Size, number> = {
  sm: 36,   // header
  md: 48,   // general
  lg: 128,  // big hero on Scrbl tab
};

export default function Logo({
  size = "md",
  href = "/",
  glow = false, // keep off to avoid the box effect with PNG
}: {
  size?: Size;
  href?: string | null;
  glow?: boolean;
}) {
  const w = px[size];
  const img = (
    <Image
      src="/scrbl.png"
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



