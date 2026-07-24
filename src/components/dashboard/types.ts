export type Widget = {
  id: string;
  source: "strava" | "whoop" | "health";
  metric: string;
  label: string;
  viewType: "stat" | "chart" | "timeline" | "ring" | "combo";
  width?: number;
  height?: number;
  color?: string;
};

export const DEFAULT_WIDGET_WIDTH = 340;
export const DEFAULT_WIDGET_HEIGHT = 240;
export const MIN_WIDGET_WIDTH = 200;
export const MIN_WIDGET_HEIGHT = 160;
export const DEFAULT_WIDGET_COLOR = "#2ee6a6";

export const CATALOG_DRAG_PREFIX = "catalog:";

// Special catalog entry: a preset combining whoop.strain + whoop.recovery
// into one widget, rather than a single real metric series.
export const WHOOP_STRAIN_RECOVERY_COMBO_ID = "whoop.strainRecoveryCombo";
