import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

// Was 3000ms, chosen purely to stop a scroll or a glance from popping edit
// chrome open. The movement check below does that job directly - a scroll,
// a swipe, or a map pan all move the pointer and cancel the hold on the
// spot - so the timer no longer has to be long enough to outlast a
// gesture. Three seconds of holding perfectly still was close to
// unusable on a touchscreen, worst of all over a Leaflet map where the
// slightest drift starts panning instead.
const LONG_PRESS_MS = 600;
// Finger jitter while holding still, in CSS px. Anything past this is a
// real gesture (scroll/pan/swipe) rather than a hold, so the press is
// abandoned rather than racing the timer.
const MOVE_TOLERANCE_PX = 10;

// Widget edit chrome (drag handle, resize handle, remove/colour/view-type
// controls) used to reveal on a plain tap or mouse hover, which meant just
// scrolling through or glancing at the dashboard could pop up editing
// controls unintentionally. Now it appears after a short hold that stays
// put - a quick tap/click doesn't select, and moving or releasing early
// cancels. Shared by DashboardWidget, TrendsWidget, CoachingWidget, and
// LiveTrackerWidget, which all had this exact same selection logic
// duplicated.
export function useLongPressSelect<T extends HTMLElement>() {
  const [selected, setSelected] = useState(false);
  const ref = useRef<T>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);

  const clearTimer = () => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    originRef.current = null;
  };

  const handlePointerDown = (e: ReactPointerEvent<T>) => {
    clearTimer();
    originRef.current = { x: e.clientX, y: e.clientY };
    timerRef.current = setTimeout(() => setSelected(true), LONG_PRESS_MS);
  };

  // Pointer events keep firing on the element that captured the gesture, so
  // this sees the movement even once the finger has travelled outside the
  // widget's own box.
  const handlePointerMove = (e: ReactPointerEvent<T>) => {
    const origin = originRef.current;
    if (!origin) return;
    if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > MOVE_TOLERANCE_PX) clearTimer();
  };

  const cancelPress = () => clearTimer();

  useEffect(() => clearTimer, []);

  useEffect(() => {
    if (!selected) return;
    const handleOutside = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setSelected(false);
    };
    document.addEventListener("pointerdown", handleOutside);
    return () => document.removeEventListener("pointerdown", handleOutside);
  }, [selected]);

  return {
    ref,
    selected,
    setSelected,
    pressHandlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: cancelPress,
      onPointerLeave: cancelPress,
      onPointerCancel: cancelPress,
    },
  };
}
