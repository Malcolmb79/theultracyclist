import { useEffect, useState } from "react";

// Fetches Whoop/Strava/Apple Health/coaching-settings ONCE and shares the
// raw JSON across every hook that needs it (useDashboardData, useCoachingData).
// Each of those used to run this exact set of fetches independently, so a
// page using more than one of them (Coaching uses both) doubled the API call
// volume on every load - which matters for a rate-limited upstream like
// Strava. Each consuming hook still does its own casting/shaping of the raw
// bodies, matching how the rest of this project keeps hooks decoupled rather
// than sharing typed shapes across files.
export type RawSourcesState =
  | { status: "loading" }
  | {
      status: "ready";
      whoop: unknown | null;
      strava: unknown | null;
      health: unknown | null;
      settings: Record<string, unknown>;
      saveSettings: (next: Record<string, unknown>) => Promise<void>;
    };

export function useRawSources(): RawSourcesState {
  const [state, setState] = useState<RawSourcesState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch("/api/whoop-data").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/strava-activities").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/health-data").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/coaching-settings").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([whoop, strava, health, settingsBody]) => {
        if (cancelled) return;

        const saveSettings = async (next: Record<string, unknown>) => {
          await fetch("/api/coaching-settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(next),
          });
          setState((prev) => (prev.status === "ready" ? { ...prev, settings: next } : prev));
        };

        setState({
          status: "ready",
          whoop,
          strava,
          health,
          settings: (settingsBody as { settings?: Record<string, unknown> } | null)?.settings ?? {},
          saveSettings,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            status: "ready",
            whoop: null,
            strava: null,
            health: null,
            settings: {},
            saveSettings: async () => {},
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
