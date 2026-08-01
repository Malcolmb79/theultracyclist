import { useCallback, useEffect, useRef, useState } from "react";
import type { DeviceCategory } from "./useDeviceCategory";
import { irelandTodayDateStr } from "./irelandDate";
import { PROJECTION_DAYS, type PlannedTss } from "./performanceSeries";

// Only the future matters here - the performance chart projects forward
// through planned work, and anything already ridden comes from Strava.
export function plannedWorkoutsPath(): string {
  const today = irelandTodayDateStr();
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + PROJECTION_DAYS);
  return `/api/planned-workouts?from=${today}&to=${end.toISOString().slice(0, 10)}`;
}

// Upper bound on any one source. Long enough that a slow-but-working response
// still lands, short enough that a hang doesn't strand the page.
const SOURCE_TIMEOUT_MS = 20_000;

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
      // The athlete's targets (weight, macros, calories, ...) as stored by
      // /api/trends-goals. Trends fetches these for its own goal widgets;
      // the dashboard needs them too now that a widget there compares
      // against a target, so they join the shared fetch rather than
      // becoming a second round-trip for the same JSON.
      goals: Record<string, unknown>;
      /** Workouts on the calendar between today and PROJECTION_DAYS ahead. */
      planned: PlannedTss[];
      settings: Record<string, unknown>;
      saveSettings: (next: Record<string, unknown>) => Promise<void>;
      // Re-runs the same fetches in the background (e.g. mobile pull-to-
      // refresh) without dropping back to "loading" first - the page's
      // existing widgets stay mounted throughout and just swap in fresh
      // data once it arrives, instead of flashing a full-page spinner.
      refetch: () => Promise<void>;
    };

// `device` scopes the coaching-settings widgets/layout fields (see
// api/coaching-settings.ts) so a phone/tablet/PC each keep their own
// Coaching-page card arrangement - the other three fetches have nothing
// device-specific about them.
export function useRawSources(device: DeviceCategory): RawSourcesState {
  const [state, setState] = useState<RawSourcesState>({ status: "loading" });
  // Guards against a slow fetch resolving after the component's moved on
  // (device changed or unmounted) - a ref rather than the effect's own
  // closure variable, since `load` is also invoked directly from outside
  // the effect (via the exposed `refetch`), not just on mount/device-change.
  const cancelledRef = useRef(false);

  const load = useCallback(async (): Promise<void> => {
    const saveSettings = async (next: Record<string, unknown>) => {
      await fetch("/api/coaching-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...next, device }),
      });
      setState((prev) => (prev.status === "ready" ? { ...prev, settings: next } : prev));
    };

    // Every source is awaited together, so without a deadline one hung
    // upstream holds the whole page on "Loading…" indefinitely - there is no
    // partial render to fall back to. A source that misses the deadline
    // resolves null, which each consumer already treats as "no data" rather
    // than an error. Generous rather than tight: the point is to bound a hang,
    // not to cut off a slow-but-working response.
    const withDeadline = async (url: string): Promise<unknown | null> => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) });
        return res.ok ? await res.json() : null;
      } catch {
        return null;
      }
    };

    try {
      const [whoop, strava, health, settingsBody, goalsBody, plannedBody] = await Promise.all([
        withDeadline("/api/whoop-data"),
        // A generous count (not the default 6 "recent rides" list) so the
        // Performance Chart's CTL/ATL/TSB has real ride history behind it
        // instead of ramping up from an artificially recent start - matches
        // Trends' own useTrendsData.ts fetch for the same reason.
        withDeadline("/api/strava-activities?count=200"),
        withDeadline("/api/health-data"),
        withDeadline(`/api/coaching-settings?device=${device}`),
        withDeadline("/api/trends-goals"),
        // Future workouts on the calendar - what the performance chart
        // projects CTL/ATL/TSB forward through.
        withDeadline(plannedWorkoutsPath()),
      ]);
      if (cancelledRef.current) return;
      setState({
        status: "ready",
        whoop,
        strava,
        health,
        goals: (goalsBody as { goals?: Record<string, unknown> } | null)?.goals ?? {},
        planned: (plannedBody as { workouts?: PlannedTss[] } | null)?.workouts ?? [],
        settings: (settingsBody as { settings?: Record<string, unknown> } | null)?.settings ?? {},
        saveSettings,
        refetch: load,
      });
    } catch {
      if (cancelledRef.current) return;
      setState({ status: "ready", whoop: null, strava: null, health: null, goals: {}, planned: [], settings: {}, saveSettings, refetch: load });
    }
    // `load` intentionally depends only on `device` - it reassigns itself as
    // each state's `refetch` via useCallback's own memoization, so callers
    // holding an earlier `refetch` reference still end up running the
    // current version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device]);

  useEffect(() => {
    cancelledRef.current = false;
    setState({ status: "loading" });
    load();
    return () => {
      cancelledRef.current = true;
    };
  }, [device, load]);

  return state;
}
