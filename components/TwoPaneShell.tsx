// components/TwoPaneShell.tsx
"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  motion,
  useAnimation,
  useMotionValue,
  useMotionValueEvent,
  useDragControls,
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

  const x = useMotionValue(0);
  const controls = useAnimation();
  const dragControls = useDragControls();

  const snapping = useRef(false);
  const COMMIT = 0.12;   // commit threshold
  const RESETTOP = 0.6; // start smooth scroll-to-top at 60% toward destination
  const firedForDest = useRef<0 | 1 | null>(null);

  // Direction lock state
  const pointerIdRef = useRef<number | null>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const decided = useRef<"h" | "v" | null>(null);

  // measure width
  useEffect(() => {
    const measure = () => setW(wrapRef.current?.clientWidth || 0);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // jump to active pane on mount/resize
  useLayoutEffect(() => {
    if (!w) return;
    x.set(-active * w);
  }, [w, active, x]);

  // Scrbl (left) cannot scroll vertically; Classes can
  useEffect(() => {
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = active === 0 ? "hidden" : "auto";
    return () => { document.body.style.overflowY = prev; };
  }, [active]);

  // Smooth scroll helper
  function smoothScrollToTop(duration = 600) {
    const start = window.scrollY || document.documentElement.scrollTop || 0;
    if (start <= 0) return;
    const startTime = performance.now();
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = ease(t);
      window.scrollTo(0, Math.round(start * (1 - eased)));
      if (t < 1) requestAnimationFrame(step);
    };
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

    await animateTo(index);
    if (index !== active) {
      // Disable Next.js instant scroll so our smooth scroll (already started) isn't overridden
      router.push(index === 0 ? "/" : "/gallery", { scroll: false });
    }
    setTimeout(() => (snapping.current = false), 150);
  }

  // Lock vertical scroll when actively swiping horizontally
  function setTouchAction(val: "none" | "pan-y") {
    if (wrapRef.current) wrapRef.current.style.touchAction = val;
  }

  // Start smooth scroll to top at 60% toward destination
  useMotionValueEvent(x, "change", (latest) => {
    if (!w) return;
    const progress = Math.min(1, Math.max(0, -latest / w)); // 0..1
    const movedAway = Math.abs(progress - active);
    const dest: 0 | 1 = progress > active ? 1 : 0;
    if (movedAway >= RESETTOP) {
      if (firedForDest.current !== dest) {
        smoothScrollToTop(600);
        firedForDest.current = dest;
      }
    } else {
      firedForDest.current = null;
    }
  });

  // Manual direction lock: decide H vs V before starting Framer's drag
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    function onPointerDown(e: PointerEvent) {
      if (e.isPrimary === false) return;
      pointerIdRef.current = e.pointerId;
      startX.current = e.clientX;
      startY.current = e.clientY;
      decided.current = null;
      firedForDest.current = null;

      window.addEventListener("pointermove", onPointerMove, { passive: true });
      window.addEventListener("pointerup", onPointerUp, { passive: true });
      window.addEventListener("pointercancel", onPointerUp, { passive: true });
    }

    function onPointerMove(e: PointerEvent) {
      if (pointerIdRef.current !== e.pointerId) return;
      if (snapping.current) return;

      const dx = e.clientX - startX.current;
      const dy = e.clientY - startY.current;

      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      const MIN = 8;    // minimum motion to decide
      const BIAS = 1.2; // horizontal vs vertical preference

      if (!decided.current) {
        if (absX > MIN && absX > absY * BIAS) {
          // Decide: horizontal swipe → start drag, lock vertical scroll
          decided.current = "h";
          setTouchAction("none");
          // Start Framer's drag flow from this native PointerEvent
          dragControls.start(e as unknown as PointerEvent);
        } else if (absY > MIN && absY > absX * BIAS) {
          // Decide: vertical scroll → do not start drag; keep horizontal locked
          decided.current = "v";
          setTouchAction("pan-y");
        }
      }
    }

    function onPointerUp(e: PointerEvent) {
      if (pointerIdRef.current !== e.pointerId) return;
      pointerIdRef.current = null;
      decided.current = null;
      setTouchAction("pan-y");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    }

    el.addEventListener("pointerdown", onPointerDown, { passive: true });
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [dragControls]);

  return (
    <div
      ref={wrapRef}
      className="overflow-hidden"
      style={{ touchAction: "pan-y" }}
    >
      <motion.div
        className="flex will-change-transform"
        drag="x"
        dragControls={dragControls}
        dragListener={false} // we start drag manually (direction lock)
        dragElastic={0.12}
        dragMomentum={false}
        dragConstraints={{ left: -Math.max(w, 0), right: 0 }}
        style={{ x }}
        animate={controls}
        onDragEnd={() => {
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
        {/* Strong isolation to prevent overlay bleed/flicker between panes */}
        <motion.section
          className="min-w-full relative overflow-hidden"
          style={{
            contain: "layout paint",
            clipPath: "inset(0)",
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden" as any,
            transform: "translateZ(0)",
          }}
        >
          {left}
        </motion.section>

        <motion.section
          className="min-w-full relative overflow-hidden"
          style={{
            contain: "layout paint",
            clipPath: "inset(0)",
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden" as any,
            transform: "translateZ(0)",
          }}
        >
          {right}
        </motion.section>
      </motion.div>
    </div>
  );
}




