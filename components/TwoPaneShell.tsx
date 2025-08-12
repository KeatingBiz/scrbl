// components/TwoPaneShell.tsx
"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, useAnimation, useMotionValue } from "framer-motion";

export default function TwoPaneShell({
  active, // 0 = Scrbl, 1 = Classes
  left,
  right,
}: {
  active: 0 | 1;
  left: React.ReactNode;
  right: React.ReactNode;
}) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);

  const x = useMotionValue(0);
  const controls = useAnimation();
  const snapping = useRef(false);

  const THRESHOLD = 0.4; // 40% away from current pane to commit (both directions)

  // measure width
  useEffect(() => {
    const measure = () => setW(wrapRef.current?.clientWidth || 0);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // set position instantly to the active pane on mount/resize
  useLayoutEffect(() => {
    if (!w) return;
    x.set(-active * w);
  }, [w, active, x]);

  function lockVertScroll(lock: boolean) {
    if (wrapRef.current) wrapRef.current.style.touchAction = lock ? "none" : "pan-y";
  }

  async function animateTo(index: 0 | 1) {
    await controls.start({
      x: -index * w,
      transition: { type: "spring", stiffness: 320, damping: 32 },
    });
  }

  async function commit(index: 0 | 1) {
    if (!w || snapping.current) return;
    snapping.current = true;

    await animateTo(index);

    if (index !== active) {
      router.push(index === 0 ? "/" : "/gallery");
    }

    // ensure destination page starts at top
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior }));
    setTimeout(() => (snapping.current = false), 150);
  }

  return (
    <div
      ref={wrapRef}
      className="overflow-hidden overscroll-y-contain"
      style={{ touchAction: "pan-y" }}
    >
      <motion.div
        className="flex"
        drag="x"
        dragElastic={0.12}
        dragMomentum={false}
        dragConstraints={{ left: -Math.max(w, 0), right: 0 }}
        style={{ x }}
        animate={controls}
        onDragStart={() => {
          if (snapping.current) return;
          // If we’re on Scrbl, jump to top immediately so there’s no “lag” later
          if (active === 0) {
            window.scrollTo(0, 0);
          }
          lockVertScroll(true);
        }}
        onDragEnd={() => {
          lockVertScroll(false);
          if (!w) return;

          // 0..1 where 0 is left pane fully in view, 1 is right pane fully in view
          const currentX = x.get();
          const progress = Math.min(1, Math.max(0, -currentX / w));
          // how far we moved away from current pane (symmetric)
          const moved = Math.abs(progress - active);

          if (moved >= THRESHOLD) {
            const target: 0 | 1 = progress > active ? 1 : 0;
            commit(target);
          } else {
            // snap back to current
            controls.start({
              x: -active * w,
              transition: { type: "spring", stiffness: 320, damping: 32 },
            });
          }
        }}
      >
        {/* Scrbl pane (locked to top during drag start) */}
        <section className="min-w-full">{left}</section>

        {/* Classes pane */}
        <section className="min-w-full">{right}</section>
      </motion.div>
    </div>
  );
}



