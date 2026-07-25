export type TrendsViewType = "day" | "week" | "month" | "calendar" | "healthCalendar";

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

export const MOBILE_DEFAULT_CALENDAR_WIDTH = 340;
export const MOBILE_DEFAULT_CALENDAR_HEIGHT = 380;
export const MOBILE_MIN_CALENDAR_WIDTH = 300;
export const MOBILE_MIN_CALENDAR_HEIGHT = 320;

export type Goals = {
  weightKg?: number;
  sleepHours?: number;
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
} as const;
