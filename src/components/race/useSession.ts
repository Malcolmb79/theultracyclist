import { useEffect } from "react";
import { useStoredState } from "../../utils/useStoredState";

/**
 * Whether the radios treat this as a race or a ride. One choice for both
 * the commentator and the coach, in every window - the console, the
 * tactics overlay - so changing it in one changes it everywhere. "auto"
 * calls an event a race (a Club Ladder one by its name) and anything else
 * a ride.
 */
export type SessionChoice = "auto" | "race" | "ride" | "ladder";

export const SESSION_OPTIONS: { value: SessionChoice; label: string }[] = [
  { value: "auto", label: "Auto (events are races)" },
  { value: "race", label: "Race" },
  { value: "ladder", label: "Club Ladder (team race)" },
  { value: "ride", label: "Ride" },
];

const KEY = "race:session";
const CHANGED = "race-session-changed";

function revive(v: unknown): SessionChoice | null {
  return v === "auto" || v === "race" || v === "ride" || v === "ladder" ? v : null;
}

export function useSession(): [SessionChoice, (next: SessionChoice) => void] {
  const [session, setSession] = useStoredState<SessionChoice>(KEY, "auto", revive);
  useEffect(() => {
    // Other windows (storage) and other radios in this one (the custom event).
    const fromStorage = (e: StorageEvent) => {
      if (e.key !== KEY || e.newValue == null) return;
      try {
        const v = revive(JSON.parse(e.newValue));
        if (v) setSession(v);
      } catch {
        // Not ours to read.
      }
    };
    const fromHere = (e: Event) => {
      const v = revive((e as CustomEvent).detail);
      if (v) setSession(v);
    };
    window.addEventListener("storage", fromStorage);
    window.addEventListener(CHANGED, fromHere);
    return () => {
      window.removeEventListener("storage", fromStorage);
      window.removeEventListener(CHANGED, fromHere);
    };
  }, [setSession]);
  return [
    session,
    (next) => {
      setSession(next);
      window.dispatchEvent(new CustomEvent(CHANGED, { detail: next }));
    },
  ];
}
