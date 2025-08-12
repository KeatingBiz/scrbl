// components/TwoPaneShell.tsx
"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  motion,
  useAnimation,
  useMotionValue,
  useMotionValueEvent,
} from "framer-motion";

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

  // horizontal position
  const x = useMotionValue(0);
  const controls = useAnimation();
  const snapping = useRef(false);

  const COMMIT = 0.3;   // commit threshold (both directions)
  const RESETTOP = 0.6; // start smooth scroll-to-top when you pass 60% toward destination

  // track if we've fired the 60% smooth-scroll for the current drag (per destination)
  const firedForDest = useRef<0 | 1 | null>(null);

  // measure width
  useEffect(() => {
    const measure = () => setW(wrapRef.current?.clientWidth || 0);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // position to the active pane instantly on mount/resize
  useLayoutEffect(() => {
    if (!w) return;
    x.set(-active * w);
  }, [w, active, x]);

  // Lock body vertical scroll on Scrbl; allow on Classes
  useEffect(() => {
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = active === 0 ? "hidden" : "auto";
    return () => {
      document.body.style.overflowY = prev;
    };
  }, [active]);

  // Smooth scroll helper (customizable duration/ease)
  function smoothScrollToTop(duration = 600) {
    const start =
      window.scrollY || document.documentElement.scrollTop || 0;
    if (start <= 0) return;
    const startTime = performance.now();

    function easeInOutCubic(t: number) {
      return t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function step(now: number) {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = easeInOutCubic(t);
      window.scrollTo(0, Math.round(start * (1 - eased)));
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
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

    // finish the horizontal slide
    await animateTo(index);

    // sync URL WITHOUT Next's auto scroll
    if (index !== active) {
      router.push(index === 0 ? "/" : "/gallery", { scroll: false });
    }

    setTimeout(() => (snapping.current = false), 150);
  }

  function lockVertScroll(lock: boolean) {
    if (wrapRef.current)
      wrapRef.current.style.touchAction = lock ? "none" : "pan-y";
  }

  // Fire the smooth scroll exactly when you pass 60% toward the destination pane.
  useMotionValueEvent(x, "change", (latest) => {
    if (!w) return;
    const progress = Math.min(1, Math.max(0, -latest / w)); // 0 (left) .. 1 (right)
    const movedAway = Math.abs(progress - active);          // distance from current pane
    const dest: 0 | 1 = progress > active ? 1 : 0;          // which side we're heading to

    if (movedAway >= RESETTOP) {
      if (firedForDest.current !== dest) {
        smoothScrollToTop(600); // tune duration if you want
        firedForDest.current = dest;
      }
    } else {
      firedForDest.current = null; // re-arm when under 60%
    }
  });

  return (
    <div ref={wrapRef} className="overflow-hidden" style={{ touchAction: "pan-y" }}>
      <motion.div
        className="flex will-change-transform"
        drag="x"
        dragElastic={0.12}
        dragMomentum={false}
        dragConstraints={{ left: -Math.max(w, 0), right: 0 }}
        style={{ x }}
        animate={controls}
        onDragStart={() => {
          if (snapping.current) return;
          firedForDest.current = null; // new drag
          lockVertScroll(true);
        }}
        onDragEnd={() => {
          lockVertScroll(false);
          if (!w) return;

          const currentX = x.get();
          const progress = Math.min(1, Math.max(0, -currentX / w));
          const movedAway = Math.abs(progress - active);

          if (movedAway >= COMMIT) {
            const target: 0 | 1 = progress > active ? 1 : 0;
            commit(target);
          } else {
            // snap back to current pane
            controls.start({
              x: -active * w,
              transition: { type: "spring", stiffness: 320, damping: 32 },
            });
          }
        }}
      >
        {/* Each pane is clipped/isolated so overlays can't bleed across */}
        <motion.section
          className="min-w-full relative overflow-hidden"
          style={{ contain: "layout paint", clipPath: "inset(0)", transform: "translateZ(0)" }}
        >
          {left}
        </motion.section>
        <motion.section
          className="min-w-full relative overflow-hidden"
          style={{ contain: "layout paint", clipPath: "inset(0)", transform: "translateZ(0)" }}
        >
          {right}
        </motion.section>
      </motion.div>
    </div>
  );
}


