// components/SwipeNav.tsx
"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

export default function SwipeNav() {
  const router = useRouter();
  const pathname = usePathname() || "/";

  const startX = useRef(0);
  const startY = useRef(0);
  const startT = useRef(0);
  const tracking = useRef(false);
  const lastNavAt = useRef(0);

  // tune these if you want
  const THRESHOLD = 64;       // min horizontal px
  const MAX_OFF_AXIS = 56;    // max vertical drift
  const MAX_DURATION = 700;    // ms
  const EDGE_GUARD = 20;      // ignore swipes that begin within 20px of edges (lets iOS back gesture breathe)

  useEffect(() => {
    function onStart(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      startX.current = t.clientX;
      startY.current = t.clientY;
      startT.current = Date.now();
      tracking.current = true;
    }

    function onEnd(e: TouchEvent) {
      if (!tracking.current) return;
      tracking.current = false;

      const dt = Date.now() - startT.current;
      if (dt > MAX_DURATION) return;

      const t = (e.changedTouches && e.changedTouches[0]) || null;
      if (!t) return;

      const dx = t.clientX - startX.current;
      const dy = t.clientY - startY.current;

      // mostly horizontal?
      if (Math.abs(dx) < THRESHOLD || Math.abs(dy) > MAX_OFF_AXIS) return;

      // don’t hijack iOS/Android edge gestures
      const vw = typeof window !== "undefined" ? window.innerWidth : 0;
      if (dx > 0 && startX.current <= EDGE_GUARD) return;                // near left edge, likely "back"
      if (dx < 0 && startX.current >= vw - EDGE_GUARD) return;           // near right edge, system gestures

      // throttle
      if (Date.now() - lastNavAt.current < 600) return;

      if (dx < 0 && pathname === "/") {
        lastNavAt.current = Date.now();
        router.push("/gallery");
      } else if (dx > 0 && pathname.startsWith("/gallery")) {
        lastNavAt.current = Date.now();
        router.push("/");
      }
    }

    // Ignore swipes starting on inputs/buttons/links
    function shouldIgnore(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return /INPUT|TEXTAREA|SELECT|BUTTON|A|LABEL/.test(tag);
    }

    function startHandler(e: TouchEvent) {
      if (shouldIgnore(e.target)) return;
      onStart(e);
    }
    function endHandler(e: TouchEvent) {
      if (shouldIgnore(e.target)) return;
      onEnd(e);
    }

    window.addEventListener("touchstart", startHandler, { passive: true });
    window.addEventListener("touchend", endHandler, { passive: true });
    return () => {
      window.removeEventListener("touchstart", startHandler);
      window.removeEventListener("touchend", endHandler);
    };
  }, [pathname, router]);

  return null; // no UI
}
