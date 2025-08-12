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

  const THRESHOLD = 0.4; // 40% commit (both directions)

  // measure width
  useEffect(() => {
    const measure = () => setW(wrapRef.current?.clientWidth || 0);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Lock/unlock vertical scroll: Scrbl locked; Classes scrollable
  useEffect(() => {
    const prev = document.body.style.overflowY;
    if (active === 0) {
      document.body.style.overflowY = "hidden"; // Scrbl can't scroll vertically
      window.scrollTo(0, 0); // ensure Scrbl is at top
    } else {
      document.body.style.overflowY = "auto";   // Classes keeps its scroll position
    }
    return () => {
      document.body.style.overflowY = prev;
    };
  }, [active]);

  // set position instantly to the active pane on mount/resize
  useLayoutEffect(() => {
    if (!w) return;
    x.set(-active * w);
  }, [w, active, x]);

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

    // Only force top when landing on Scrbl; Classes keeps its scroll position
    if (index === 0) requestAnimationFrame(() => window.scrollTo(0, 0));

    setTimeout(() => (snapping.current = false), 150);
  }

  // Lock vertical scroll while dragging for smooth horizontal swipe
  function lockVertScroll(lock: boolean) {
    if (wrapRef.current) wrapRef.current.style.touchAction = lock ? "none" : "pan-y";
  }

  // Scroll to top exactly when crossing 40% toward Scrbl (NOT toward Classes)
  const lastCrossedDest = useRef<0 | 1 | null>(null);
  useMotionValueEvent(x, "change", (latest) => {
    if (!w) return;
    const progress = Math.min(1, Math.max(0, -latest / w)); // 0..1
    const movedAway = Math.abs(progress - active);          // distance from current pane
    const dest: 0 | 1 = progress > active ? 1 : 0;          // which side we're moving toward

    if (movedAway >= THRESHOLD) {
      if (lastCrossedDest.current !== dest) {
        if (dest === 0) {
          // heading to Scrbl → make the finish look seamless
          window.scrollTo(0, 0);
        }
        lastCrossedDest.current = dest;
      }
    } else {
      lastCrossedDest.current = null; // re-arm when under threshold
    }
  });

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
        {/* Scrbl pane (vertical scrolling disabled via body lock) */}
        <section className="min-w-full overflow-hidden">{left}</section>

        {/* Classes pane (keeps its own scroll position) */}
        <section className="min-w-full">{right}</section>
      </motion.div>
    </div>
  );
}




