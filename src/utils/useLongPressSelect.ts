import { useEffect, useRef, useState } from "react";

const LONG_PRESS_MS = 3000;

// Widget edit chrome (drag handle, resize handle, remove/colour/view-type
// controls) used to reveal on a plain tap or mouse hover, which meant just
// scrolling through or glancing at the dashboard could pop up editing
// controls unintentionally. Now it only appears after holding a widget for
// 3 seconds - a quick tap/click no longer selects it, and releasing early
// cancels the hold. Shared by DashboardWidget, TrendsWidget, and
// CoachingWidget, which all had this exact same selection logic duplicated.
export function useLongPressSelect<T extends HTMLElement>() {
  const [selected, setSelected] = useState(false);
  const ref = useRef<T>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handlePointerDown = () => {
    clearTimer();
    timerRef.current = setTimeout(() => setSelected(true), LONG_PRESS_MS);
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
      onPointerUp: cancelPress,
      onPointerLeave: cancelPress,
      onPointerCancel: cancelPress,
    },
  };
}
