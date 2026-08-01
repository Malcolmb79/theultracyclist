import type { WidgetDateRange } from "../../utils/dateRange";

export type Widget = {
  id: string;
  source: "strava" | "whoop" | "health" | "weather" | "garmin";
  metric: string;
  label: string;
  viewType: "stat" | "chart" | "timeline" | "ring" | "combo" | "rings" | "healthCalendar" | "caloriesBalance" | "macroSplit";
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color?: string;
  /**
   * The window this widget draws. Absent, or id "inherit", means it follows
   * the default set for its page in Settings - which is what almost every
   * widget does, so it is stored only once a widget is given one of its own.
   */
  dateRange?: WidgetDateRange;
};

export const DEFAULT_WIDGET_WIDTH = 340;
export const DEFAULT_WIDGET_HEIGHT = 240;
export const MIN_WIDGET_WIDTH = 240;
export const MIN_WIDGET_HEIGHT = 160;

// Smaller sizing used when useIsMobile() is true, so widgets default to
// something that fits a phone screen without excessive scrolling, and can
// wrap multiple-per-row instead of each one claiming the full width.
export const MOBILE_DEFAULT_WIDGET_WIDTH = 160;
export const MOBILE_DEFAULT_WIDGET_HEIGHT = 140;
export const MOBILE_MIN_WIDGET_WIDTH = 140;
export const MOBILE_MIN_WIDGET_HEIGHT = 110;
// A widget already sized for desktop (e.g. a saved 340px-wide stat tile)
// gets visually capped down to this on mobile rather than staying at its
// desktop size - the saved value itself is untouched, so switching back to
// a wider screen restores it. Only applies to plain stat/ring/chart/
// timeline widgets; combo/rings need more room than this to render at all,
// so they keep their own (larger) minimum uncapped.
export const MOBILE_CAP_WIDTH = 220;
export const MOBILE_CAP_HEIGHT = 200;

export const DEFAULT_WIDGET_COLOR = "#2ee6a6";
export const WIDGET_GRID_SIZE = 20;

// Special catalog entry: a preset combining whoop.strain + whoop.recovery
// into one widget, rather than a single real metric series.
export const WHOOP_STRAIN_RECOVERY_COMBO_ID = "whoop.strainRecoveryCombo";

// Special catalog entry: a compact Sleep/Recovery/Strain 3-ring row,
// matching Whoop's own summary strip - each ring opens that metric's detail.
export const WHOOP_RINGS_COMBO_ID = "whoop.sleepRecoveryStrainRings";

// Special catalog entry: a single month calendar with Strain/Recovery/
// Sleep/HRV/Weight all shown per day (small color dots), rather than one
// metric per calendar the way Trends' calendar view works.
export const HEALTH_CALENDAR_ID = "whoop.healthCalendar";

// Special catalog entry: dietary (consumed) vs active+basal (burned)
// energy for the day, side by side with the net difference - rather than
// two separate single-metric widgets the athlete has to compare by eye.
export const CALORIES_BALANCE_ID = "health.caloriesBalance";

// Special catalog entry: the season's Performance Management Chart
// (CTL/ATL/TSB, the standard Coggan fitness/fatigue/form trio) with the
// athlete's real ATP plan targets for CTL/TSB overlaid, rather than a raw
// per-metric series the way a normal catalog entry works.
export const PERFORMANCE_CHART_ID = "strava.performanceChart";

// Special catalog entry: current weather at the athlete's location (browser
// geolocation + Open-Meteo, no per-metric series).
export const WEATHER_ID = "weather.current";

// Special catalog entry: carbohydrate/fat/protein as shares of the day's
// energy, in one donut with the athlete's target split beside it - the
// separate "Protein vs goal"/"Carbs vs goal" widgets each answer whether one
// macro hit its number, never how the day actually divided up.
export const MACRO_SPLIT_ID = "health.macroSplit";

// Special catalog entry: the athlete's currently pasted Garmin LiveTrack
// session, embedded directly (see GarminLiveTrackCard.tsx and Settings) -
// no per-metric series, always offered regardless of connected data sources.
export const GARMIN_LIVETRACK_ID = "garmin.liveTrack";
