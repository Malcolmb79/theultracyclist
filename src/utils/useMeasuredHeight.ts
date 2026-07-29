import { useEffect, useRef, useState } from "react";

// The vertical counterpart to useMeasuredWidth, for the same reason: layout
// that depends on how much room a sibling actually takes should measure it
// rather than assume a constant. Reports the border-box height (offsetHeight,
// so padding counts) because callers are subtracting it from an available
// height, and reserving only the content box would under-count by the
// element's own padding.
export function useMeasuredHeight(fallbackHeight: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(fallbackHeight);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (el.offsetHeight) setHeight(el.offsetHeight);
    });
    observer.observe(el);
    if (el.offsetHeight) setHeight(el.offsetHeight);
    return () => observer.disconnect();
  }, []);

  return [ref, height] as const;
}
