import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { UnitSystem } from "../utils/units";

const STORAGE_KEY = "unitSystem";

interface UnitsContextValue {
  system: UnitSystem;
  setSystem: (system: UnitSystem) => void;
}

const UnitsContext = createContext<UnitsContextValue | null>(null);

function readStoredSystem(): UnitSystem {
  if (typeof window === "undefined") return "metric";
  return window.localStorage.getItem(STORAGE_KEY) === "imperial" ? "imperial" : "metric";
}

/**
 * Mirrors the choice to the server as well as localStorage.
 *
 * localStorage stays the initial read, so the first paint is never in the wrong
 * units while a fetch is in flight. But anything rendered away from the browser
 * has no localStorage to consult - the WhatsApp widget images were showing
 * kilograms regardless of this setting - so the preference is stored in
 * coaching-settings too.
 *
 * Saved by read-modify-write rather than posting the single field: the settings
 * endpoint rebuilds its record from whatever it receives, so a partial post
 * would wipe FTP, height and the rest.
 */
async function persistSystem(next: UnitSystem): Promise<void> {
  try {
    const current = await fetch("/api/coaching-settings").then((r) => (r.ok ? r.json() : null));
    // Signed out, or the public marketing site - nothing to save to, and the
    // local choice still governs this browser.
    if (!current?.settings) return;
    await fetch("/api/coaching-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...current.settings, unitSystem: next }),
    });
  } catch {
    // A failed sync leaves the local choice intact and correct here.
  }
}

export function UnitsProvider({ children }: { children: ReactNode }) {
  const [system, setSystemState] = useState<UnitSystem>(readStoredSystem);

  // A device that has never chosen adopts the stored preference, so a new phone
  // matches the athlete instead of silently defaulting to metric.
  useEffect(() => {
    if (typeof window === "undefined" || window.localStorage.getItem(STORAGE_KEY)) return;
    let cancelled = false;
    fetch("/api/coaching-settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        const stored = body?.settings?.unitSystem;
        if (!cancelled && (stored === "metric" || stored === "imperial")) {
          setSystemState(stored);
          window.localStorage.setItem(STORAGE_KEY, stored);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const setSystem = (next: UnitSystem) => {
    setSystemState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    void persistSystem(next);
  };

  return <UnitsContext.Provider value={{ system, setSystem }}>{children}</UnitsContext.Provider>;
}

export function useUnits(): UnitsContextValue {
  const ctx = useContext(UnitsContext);
  if (!ctx) throw new Error("useUnits must be used within a UnitsProvider");
  return ctx;
}
