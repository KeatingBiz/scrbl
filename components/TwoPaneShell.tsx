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
  const dragStartX = useRef(0);
  const navigating = useRef(false);

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

  // helper to animate then sync URL + scroll top
  async function commit(index: 0 | 1) {
    if (!w || navigating.current) return;
    navigating.current = true;

    // animate to target pane
    await controls.start({
      x: -index * w,
      transition: { type: "spring", stiffness: 320, damping: 32 },
    });

    // sync URL after the animation finishes
    router.push(index === 0 ? "/" : "/gallery");

    // ensure the new page starts at top
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior }));
    // small delay before allowing another nav
    setTimeout(() => (navigating.current = false), 200);
  }

  // while swiping, disable vertical scroll for smoother horizontal drag
  function setTouchAction(val: "none" | "pan-y") {
    if (wrapRef.current) wrapRef.current.style.touchAction = val;
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
        onDragStart={(_, info) => {
          dragStartX.current = x.get();
          setTouchAction("none"); // lock vertical while we decide
        }}
        onDragEnd={(_, info) => {
          setTouchAction("pan-y"); // restore vertical scroll
          if (!w) return;

          // where we ended relative to drag start
          const endX = dragStartX.current + info.offset.x;
          const progress = -endX / w; // 0..1 between panes
          const vx = info.velocity.x;

          // commit rules: >50% progress to right pane OR fast fling
          if (progress > 0.5 || vx < -300) {
            commit(1);
          } else if (progress < 0.5 && vx > 300) {
            commit(0);
          } else {
            // snap back to the nearest pane without URL change
            const nearest = progress >= 0.5 ? 1 : 0;
            controls.start({
              x: -nearest * w,
              transition: { type: "spring", stiffness: 320, damping: 32 },
            });
          }
        }}
      >
        <section className="min-w-full">{left}</section>
        <section className="min-w-full">{right}</section>
      </motion.div>
    </div>
  );
}

