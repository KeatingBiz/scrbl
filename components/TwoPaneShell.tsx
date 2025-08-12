// components/TwoPaneShell.tsx
"use client";

import { useEffect, useRef, useState } from "react";
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
  const startAt = useRef(0);

  // measure width
  useEffect(() => {
    const measure = () => setW(wrapRef.current?.clientWidth || 0);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // jump/animate to active pane on route change
  useEffect(() => {
    if (!w) return;
    controls.start({
      x: -active * w,
      transition: { type: "spring", stiffness: 320, damping: 32 },
    });
  }, [active, w, controls]);

  function commit(index: 0 | 1) {
    controls.start({
      x: -index * w,
      transition: { type: "spring", stiffness: 320, damping: 32 },
    });
    router.push(index === 0 ? "/" : "/gallery");
  }

  return (
    <div ref={wrapRef} className="overflow-hidden" style={{ touchAction: "pan-y" }}>
      <motion.div
        className="flex"
        drag="x"
        dragElastic={0.12}
        dragConstraints={{ left: -Math.max(w, 0), right: 0 }}
        style={{ x }}
        onDragStart={() => {
          startAt.current = (x.get?.() as number) ?? 0;
        }}
        onDragEnd={(_, info) => {
          if (!w) return;
          const current = startAt.current + info.offset.x; // where we ended up
          const velocity = info.velocity.x;
          const halfway = -w / 2;

          // decide target pane
          let target: 0 | 1 = 0;
          if (current < halfway || velocity < -300) target = 1;
          if (current > halfway && velocity > 300) target = 0;

          commit(target);
        }}
      >
        <section className="min-w-full">{left}</section>
        <section className="min-w-full">{right}</section>
      </motion.div>
    </div>
  );
}
