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

    // Only push if we’re changing pages
    if (index !== active) {
      router.push(index === 0 ? "/" : "/gallery");
    }

    // Ensure destination page starts at the top
    requestAnimationFrame(() =>
      window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior })
    );

    setTimeout(() => {
      snapping.current = false;
    }, 150);
  }

  return (
    <div ref={wrapRef} className="overflow-hidden" style={{ touchAction: "pan-y" }}>
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
          lockVertScroll(true);
        }}
        onDragEnd={() => {
          lockVertScroll(false);
          if (!w) return;
          // Read the actual position at release
          const currentX = x.get();
          const progress = Math.min(1, Math.max(0, -currentX / w)); // 0..1

          // Strict 40% rule: > 0.4 goes to right pane, else left.
          const target: 0 | 1 = progress > 0.4 ? 1 : 0;

          // If target is the same as current route, just snap back; else commit (animate + push)
          if (target === active) {
            controls.start({
              x: -active * w,
              transition: { type: "spring", stiffness: 320, damping: 32 },
            });
          } else {
            commit(target);
          }
        }}
      >
        <section className="min-w-full">{left}</section>
        <section className="min-w-full">{right}</section>
      </motion.div>
    </div>
  );
}


