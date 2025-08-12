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
  const COMMIT = 0.12;
  const RESETTOP = 0.6;
  const firedForDest = useRef<0 | 1 | null>(null);

  // direction lock
  const pointerIdRef = useRef<number | null>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const decided = useRef<"h" | "v" | null>(null);

  // Measure & position BEFORE paint
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const apply = () => {
      const width = el.clientWidth || 0;
      setW(width);
      // set the motion value immediately so first painted inline transform is correct
      x.set(-active * width);
    };

    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active, x]);

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
      router.push(index === 0 ? "/" : "/gallery", { scroll: false });
    }
    setTimeout(() => (snapping.current = false), 150);
  }

  function setTouchAction(val: "none" | "pan-y") {
    if (wrapRef.current) wrapRef.current.style.touchAction = val;
  }

  useMotionValueEvent(x, "change", (latest) => {
    if (!w) return;
    const progress = Math.min(1, Math.max(0, -latest / w));
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
      const MIN = 8;
      const BIAS = 1.2;

      if (!decided.current) {
        if (absX > MIN && absX > absY * BIAS) {
          decided.current = "h";
          setTouchAction("none");
          dragControls.start(e as unknown as PointerEvent);
        } else if (absY > MIN && absY > absX * BIAS) {
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

  // SSR-first frame: use CSS shift; do NOT apply inline x until width is known
  const initialShiftClass = w === 0 && active === 1 ? "-translate-x-full" : "";

  return (
    <div ref={wrapRef} className="overflow-hidden" style={{ touchAction: "pan-y" }}>
      <motion.div
        className={`flex will-change-transform ${initialShiftClass}`}
        initial={false}
        drag="x"
        dragControls={dragControls}
        dragListener={false}
        dragElastic={0.12}
        dragMomentum={false}
        dragConstraints={{ left: -Math.max(w, 0), right: 0 }}
        // 🔑 only attach inline transform after width is known
        style={{ x: w ? x : undefined, visibility: w ? "visible" : "hidden" }}
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
            controls.start({
              x: -active * w,
              transition: { type: "spring", stiffness: 320, damping: 32 },
            });
          }
        }}
      >
        {/* Panes */}
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






