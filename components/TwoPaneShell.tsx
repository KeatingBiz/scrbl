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

  // horizontal position
  const x = useMotionValue(0);
  const controls = useAnimation();
  const snapping = useRef(false);

  // subtle "settle" animation on the entering pane
  const leftSettle = useAnimation();
  const rightSettle = useAnimation();

  const THRESHOLD = 0.4; // commit at 40%

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

  // lock/unlock body vertical scroll: Scrbl locked; Classes scrollable
  useEffect(() => {
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = active === 0 ? "hidden" : "auto";
    return () => {
      document.body.style.overflowY = prev;
    };
  }, [active]);

  // when this shell mounts (or active changes due to route), play a tiny settle on the active pane
  useEffect(() => {
    const ctrl = active === 0 ? leftSettle : rightSettle;
    // start from slightly above and ease down to 0
    ctrl.start({
      y: [-10, 0],
      opacity: [0.98, 1],
      transition: { duration: 0.28, ease: "easeOut" },
    });
    // reset the inactive pane so it’s neutral next time
    (active === 0 ? rightSettle : leftSettle).set({ y: 0, opacity: 1 });
  }, [active, leftSettle, rightSettle]);

  async function animateTo(index: 0 | 1) {
    await controls.start({
      x: -index * w,
      transition: { type: "spring", stiffness: 320, damping: 32 },
    });
  }

  async function commit(index: 0 | 1) {
    if (!w || snapping.current) return;
    snapping.current = true;

    // finish the horizontal slide first
    await animateTo(index);

    // then sync URL (Next.js will restore scroll to top by default)
    if (index !== active) {
      router.push(index === 0 ? "/" : "/gallery");
    }

    setTimeout(() => (snapping.current = false), 150);
  }

  function lockVertScroll(lock: boolean) {
    if (wrapRef.current) wrapRef.current.style.touchAction = lock ? "none" : "pan-y";
  }

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
          lockVertScroll(true);
        }}
        onDragEnd={() => {
          lockVertScroll(false);
          if (!w) return;

          const currentX = x.get();
          const progress = Math.min(1, Math.max(0, -currentX / w)); // 0..1
          const movedAway = Math.abs(progress - active);

          if (movedAway >= THRESHOLD) {
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
        {/* Each pane is its own stacked, clipped island so overlays don’t bleed */}
        <motion.section
          className="min-w-full relative isolate overflow-hidden"
          animate={leftSettle}
          initial={false}
        >
          {left}
        </motion.section>

        <motion.section
          className="min-w-full relative isolate overflow-hidden"
          animate={rightSettle}
          initial={false}
        >
          {right}
        </motion.section>
      </motion.div>
    </div>
  );
}






