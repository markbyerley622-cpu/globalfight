"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Mounts its children only once the placeholder scrolls near the viewport.
 * Used to keep expensive-on-mount islands (e.g. the event discussion, which
 * POSTs to provision a thread) off the critical path on a single-scroll page —
 * the work fires when the reader actually reaches the section, exactly as the
 * old tab did when opened. Observes inside the `#main` scroll container.
 */
export function WhenVisible({
  children,
  rootMargin = "400px",
  placeholder,
}: {
  children: React.ReactNode;
  rootMargin?: string;
  placeholder?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (shown) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setShown(true);
      },
      { root: document.getElementById("main"), rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown, rootMargin]);

  return <div ref={ref}>{shown ? children : placeholder}</div>;
}
