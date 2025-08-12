// components/TwoPaneShell.tsx
"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, useAnimation, useMotionValue, useMotionValueEvent } from "framer-motion";

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

  const COMMIT = 0.4;     // commit threshold (both directions)
  const RESETTOP = 0.6;   // when crossing this toward the destination, reset scroll-to-top

  // track if we've already fired the 60% reset for this drag toward a given dest
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
    return () => { document.body.style.overflowY = prev; };
  }, [active]);

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
      // Next.js will scroll the document to top on route change (desired).
      router.push(index === 0 ? "/" : "/gallery");
    }

    setTimeout(() => (snapping.current = false), 150);
  }

  function lockVertScroll(lock: boolean) {
    if (wrapRef.current) wrapRef.current.style.touchAction = lock ? "none" : "pan-y";
  }

  // Fire the "reset to top" exactly when you pass 60% toward the destination pane.
  useMotionValueEvent(x, "change", (latest) => {
    if (!w) return;
    const progress = Math.min(1, Math.max(0, -latest / w));  // 0 (left) .. 1 (right)
    const movedAway = Math.abs(progress - active);           // distance from current pane
    const dest: 0 | 1 = progress > active ? 1 : 0;           // which side we're heading to

    if (movedAway >= RESETTOP) {
      if (firedForDest.current !== dest) {
        // reset document scroll while the slide is still moving toward the new page
        window.scrollTo(0, 0);
        firedForDest.current = dest;
      }
    } else {
      // drop back under the threshold → re-arm
      firedForDest.current = null;
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
          firedForDest.current = null; // fresh drag
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
        {/* Each pane is fully clipped & isolated to avoid overlay bleed/flicker */}
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

