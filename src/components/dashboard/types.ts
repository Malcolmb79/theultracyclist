export type Widget = {
  id: string;
  source: "strava" | "whoop" | "health";
  metric: string;
  label: string;
  viewType: "stat" | "chart" | "timeline" | "ring" | "combo" | "rings";
  width?: number;
  height?: number;
  color?: string;
};

export const DEFAULT_WIDGET_WIDTH = 340;
export const DEFAULT_WIDGET_HEIGHT = 240;
export const MIN_WIDGET_WIDTH = 240;
export const MIN_WIDGET_HEIGHT = 160;
export const DEFAULT_WIDGET_COLOR = "#2ee6a6";
export const WIDGET_GRID_SIZE = 20;

export const CATALOG_DRAG_PREFIX = "catalog:";

// Special catalog entry: a preset combining whoop.strain + whoop.recovery
// into one widget, rather than a single real metric series.
export const WHOOP_STRAIN_RECOVERY_COMBO_ID = "whoop.strainRecoveryCombo";

// Special catalog entry: a compact Sleep/Recovery/Strain 3-ring row,
// matching Whoop's own summary strip - each ring opens that metric's detail.
export const WHOOP_RINGS_COMBO_ID = "whoop.sleepRecoveryStrainRings";
