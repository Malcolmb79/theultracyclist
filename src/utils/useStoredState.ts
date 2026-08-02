import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/**
 * useState backed by localStorage, so a choice survives a refresh.
 *
 * localStorage rather than the server: these are per-viewer display
 * preferences, not part of the layout the athlete arranges for everyone
 * (see api/live-tracker.ts for that). Someone dot-watching who only cares
 * about heart rate should be able to say so without it changing what
 * anybody else sees.
 *
 * `revive` validates whatever comes back out. Stored values outlive the code
 * that wrote them - a field id can be renamed or dropped between deploys -
 * and restoring one blindly means a saved preference from an old build can
 * break the page for as long as it sits in that browser. Returning null
 * falls back to the initial value.
 *
 * Every access is wrapped: localStorage throws outright in some private
 * browsing modes and when the origin's quota is full, and a display
 * preference is never worth taking the page down for.
 */
export function useStoredState<T>(
  key: string,
  initial: T,
  revive: (stored: unknown) => T | null,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw == null) return initial;
      return revive(JSON.parse(raw)) ?? initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Full or unavailable - the preference just won't persist.
    }
  }, [key, value]);

  return [value, setValue];
}
