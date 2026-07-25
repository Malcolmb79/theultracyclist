import { useEffect, useRef, useState } from "react";

// Measures a container's actual rendered width via ResizeObserver, so
// layout that depends on available width (chart scaling, ring sizing) uses
// the real number instead of back-computing it from a parent's stored
// width minus assumed padding/border/gap constants - which drifts out of
// sync with the actual CSS the moment any of those change, silently
// causing content to overflow and clip.
export function useMeasuredWidth(fallbackWidth: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallbackWidth);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    observer.observe(el);
    if (el.clientWidth) setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}
