import { useEffect, useRef, useState } from "react";

// How far (px) a downward drag needs to travel, starting from the very top
// of the page, before releasing triggers a refresh.
const TRIGGER_DISTANCE = 70;
// Visual cap so the indicator doesn't keep growing the further past the
// trigger point the finger drags.
const MAX_PULL_DISTANCE = 110;

// Re-implements "drag down at the top of the page to refresh" for mobile -
// not a built-in browser behavior inside a single-page app (only a full
// native page reload triggers the OS-level version, which would blow away
// all React state), so this tracks a downward pointer drag that starts
// while already scrolled to the very top, and calls onRefresh once it's
// pulled past TRIGGER_DISTANCE and released.
//
// Widget drag/resize handles (see useCanvasItem.ts's trackPointer) already
// call stopPropagation() on their own pointerdown, so a drag started on one
// of those never reaches this hook's window-level listener - no extra
// exclusion logic needed to keep the two gestures from fighting each other.
export function usePullToRefresh(onRefresh: () => Promise<void>) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const liveDistance = useRef(0);
  const refreshingRef = useRef(false);

  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || window.scrollY > 0 || refreshingRef.current) return;
      startY.current = e.clientY;
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (startY.current == null) return;
      const delta = e.clientY - startY.current;
      if (delta <= 0 || window.scrollY > 0) {
        // Not actually pulling down from the top anymore (e.g. the page
        // itself scrolled under the finger) - cancel rather than fight it.
        startY.current = null;
        liveDistance.current = 0;
        setPullDistance(0);
        return;
      }
      // Dragging down at the top would otherwise also trigger the browser's
      // own native overscroll/pull-to-reload - suppress that so only this
      // in-app version fires.
      e.preventDefault();
      const distance = Math.min(MAX_PULL_DISTANCE, delta);
      liveDistance.current = distance;
      setPullDistance(distance);
    };

    const finish = () => {
      if (startY.current == null) return;
      startY.current = null;
      const finalDistance = liveDistance.current;
      liveDistance.current = 0;
      setPullDistance(0);
      if (finalDistance >= TRIGGER_DISTANCE) {
        refreshingRef.current = true;
        setRefreshing(true);
        onRefresh().finally(() => {
          refreshingRef.current = false;
          setRefreshing(false);
        });
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [onRefresh]);

  return { pullDistance, refreshing, triggerDistance: TRIGGER_DISTANCE };
}
