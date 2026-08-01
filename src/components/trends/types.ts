import type { WidgetDateRange } from "../../utils/dateRange";
export type TrendsViewType =
  | "day"
  | "week"
  | "month"
  | "calendar"
  | "healthCalendar"
  | "performanceChart"
  // A goal with a deadline: how far there is to go and whether the pace gets
  // there in time. The day/week/month views answer a different question —
  // whether the target was met in a period — and cannot express a deadline.
  | "goalProgress"
  // Photographs rather than a metric: no time range applies to it.
  | "progressPhotos"
  // Three macros as shares of one day's energy - a composition, not a series.
  | "macroSplit"
  // Consumed vs burned energy, totalled over the selected range.
  | "caloriesBalance"
  // Every recorded session from every source, listed - not an aggregate, so
  // the day/week/month pills don't apply to it.
  | "allActivity";

export type TrendsWidgetConfig = {
  id: string;
  metric: string;
  label: string;
  viewType: TrendsViewType;
  color?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** See Widget["dateRange"] - same model, same picker. */
  dateRange?: WidgetDateRange;
};

export const DEFAULT_WIDGET_WIDTH = 200;
export const DEFAULT_WIDGET_HEIGHT = 160;
export const MIN_WIDGET_WIDTH = 200;
export const MIN_WIDGET_HEIGHT = 160;
// Calendar needs real room to show a value per day - a 7-column grid at the
// stat-widget minimum would give ~25px cells, unreadable. Default big enough
// to show the current month clearly; still user-resizable from there.
export const DEFAULT_CALENDAR_WIDTH = 480;
export const DEFAULT_CALENDAR_HEIGHT = 460;
export const MIN_CALENDAR_WIDTH = 420;
export const MIN_CALENDAR_HEIGHT = 420;
export const WIDGET_GRID_SIZE = 20;

// Mobile-scaled sizing, mirroring the main dashboard's approach: smaller
// defaults/minimums for newly-added widgets, plus a cap that visually
// compresses an already-desktop-sized saved widget on a phone screen
// without touching the saved value itself.
export const MOBILE_DEFAULT_WIDGET_WIDTH = 140;
export const MOBILE_DEFAULT_WIDGET_HEIGHT = 120;
export const MOBILE_MIN_WIDGET_WIDTH = 140;
export const MOBILE_MIN_WIDGET_HEIGHT = 110;
export const MOBILE_CAP_WIDTH = 170;
export const MOBILE_CAP_HEIGHT = 150;

// Two labelled bars, a net line and a caption, plus the range pills above
// them - more than a stat widget's floor, well short of a calendar's.
export const MIN_CALORIES_WIDTH = 240;
export const MIN_CALORIES_HEIGHT = 260;
export const DEFAULT_CALORIES_WIDTH = 300;
export const DEFAULT_CALORIES_HEIGHT = 280;

export const MOBILE_DEFAULT_CALENDAR_WIDTH = 340;
export const MOBILE_DEFAULT_CALENDAR_HEIGHT = 380;
export const MOBILE_MIN_CALENDAR_WIDTH = 300;
export const MOBILE_MIN_CALENDAR_HEIGHT = 320;

export type Goals = {
  weightKg?: number;
  /** When the weight target is meant to be reached — ISO date. */
  weightTargetDate?: string;
  sleepHours?: number;
  /** Functional threshold power aimed for, in watts. */
  ftpTargetWatts?: number;
  /** When the FTP target is meant to be reached — ISO date. */
  ftpTargetDate?: string;
  proteinG?: number;
  fatG?: number;
  carbsG?: number;
  calorieGoalTrainingDay?: number;
  calorieGoalRestDay?: number;
};

export const DEFAULT_TRENDS_COLOR = "#2ee6a6";

// Goal-backed metrics compare a real value against a target from Goals
// rather than just displaying a raw number - the widget catalog offers
// these alongside the regular per-source metrics.
export const GOAL_METRIC_IDS = {
  weight: "goal.weight",
  sleep: "goal.sleep",
  protein: "goal.protein",
  fat: "goal.fat",
  carbs: "goal.carbs",
  calories: "goal.calories",
  sleepWeekly: "goal.sleepWeekly",
  ftp: "goal.ftp",
} as const;

/** The progress photo widget, which has no underlying metric series. */
export const PROGRESS_PHOTOS_ID = "progress.photos";

/**
 * A goal with a deadline, as the progress view needs it.
 *
 * The per-day goal metrics answer "did I hit it today". These answer "will I
 * get there by then", which needs a start, a target and a date, and is a
 * different question with a different shape.
 */
export type DatedGoal = {
  label: string;
  unit: string;
  /** Where it stands now. */
  current: number | null;
  target: number | null;
  targetDate?: string;
  /** Value when the goal was first tracked, so progress has something to measure from. */
  start: number | null;
  /** Which way counts as progress. */
  direction: "down" | "up";
  /**
   * An optional second reading of the same two figures, derived by dividing
   * them - FTP in W/kg beside FTP in watts.
   *
   * The two divisors are separate on purpose: "now" divides by what the
   * athlete weighs today, while "target" divides by the weight goal, so the
   * target figure describes the intended end state rather than today's body
   * at tomorrow's power. That does mean the W/kg gap spans both goals at
   * once - reaching it needs the weight target as well as the power one,
   * which is the point of aligning them.
   */
  secondary?: {
    unit: string;
    currentDivisor: number;
    targetDivisor: number;
    /** Spells out the target divisor, e.g. "at 63kg", when it differs from today's. */
    targetNote?: string;
  };
};
