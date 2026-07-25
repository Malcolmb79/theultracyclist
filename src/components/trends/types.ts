export type TrendsViewType = "day" | "week" | "month" | "calendar";

export type TrendsWidgetConfig = {
  id: string;
  metric: string;
  label: string;
  viewType: TrendsViewType;
  color?: string;
};

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
