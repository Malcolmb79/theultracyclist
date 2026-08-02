import { useCallback, useRef, useState } from "react";

// Measures a container's actual rendered width via ResizeObserver, so
// layout that depends on available width (chart scaling, ring sizing) uses
// the real number instead of back-computing it from a parent's stored
// width minus assumed padding/border/gap constants - which drifts out of
// sync with the actual CSS the moment any of those change, silently
// causing content to overflow and clip.
export function useMeasuredWidth<T extends HTMLElement = HTMLDivElement>(fallbackWidth: number) {
  const [width, setWidth] = useState(fallbackWidth);
  const observerRef = useRef<ResizeObserver | null>(null);

  // A callback ref rather than a ref object plus a mount effect. The
  // measured element is often behind a loading state - LiveTrackerPage
  // renders "Loading…" until its first poll lands, so its canvas doesn't
  // exist yet on the first commit - and an effect with [] deps runs once,
  // finds ref.current still null, and never observes anything. The width
  // then stays on the fallback forever, which is the worst kind of bug to
  // spot: a fallback is a plausible-looking number, so the layout is just
  // quietly sized for the wrong screen. A callback ref fires whenever the
  // node actually attaches or detaches, whenever that happens to be.
  const ref = useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    observer.observe(node);
    observerRef.current = observer;
    if (node.clientWidth) setWidth(node.clientWidth);
  }, []);

  return [ref, width] as const;
}
