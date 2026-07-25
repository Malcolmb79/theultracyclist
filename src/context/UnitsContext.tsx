import { createContext, useContext, useState, type ReactNode } from "react";
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

export function UnitsProvider({ children }: { children: ReactNode }) {
  const [system, setSystemState] = useState<UnitSystem>(readStoredSystem);

  const setSystem = (next: UnitSystem) => {
    setSystemState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  return <UnitsContext.Provider value={{ system, setSystem }}>{children}</UnitsContext.Provider>;
}

export function useUnits(): UnitsContextValue {
  const ctx = useContext(UnitsContext);
  if (!ctx) throw new Error("useUnits must be used within a UnitsProvider");
  return ctx;
}
