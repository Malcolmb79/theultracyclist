import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { isDaytime } from "../utils/sunTimes";

export type ThemeMode = "light" | "dark" | "auto";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "themeMode";
// Dublin - used for the "auto" (sunrise/sunset) mode whenever geolocation is
// denied/unavailable, matching the app's own Ireland home base rather than
// guessing. Same "missing config degrades gracefully" pattern used
// throughout this app's other optional integrations.
const FALLBACK_COORDS = { lat: 53.3498, lon: -6.2603 };
const AUTO_RECHECK_MS = 60_000;

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  resolvedTheme: ResolvedTheme;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredMode(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "auto" ? stored : "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const coordsRef = useRef(FALLBACK_COORDS);
  const [autoIsDay, setAutoIsDay] = useState(() => isDaytime(new Date(), FALLBACK_COORDS.lat, FALLBACK_COORDS.lon));

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  useEffect(() => {
    if (mode !== "auto") return;

    let cancelled = false;
    const recheck = () => setAutoIsDay(isDaytime(new Date(), coordsRef.current.lat, coordsRef.current.lon));

    // Best-effort real location for an accurate sunrise/sunset - silently
    // keeps the Ireland fallback on denial/timeout/unsupported browsers.
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;
          coordsRef.current = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          recheck();
        },
        () => {},
        { timeout: 8000, maximumAge: 3_600_000 },
      );
    }

    recheck();
    const interval = window.setInterval(recheck, AUTO_RECHECK_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [mode]);

  const resolvedTheme: ResolvedTheme = mode === "auto" ? (autoIsDay ? "light" : "dark") : mode;

  return <ThemeContext.Provider value={{ mode, setMode, resolvedTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
