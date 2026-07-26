import type { ReactNode } from "react";
import { useCanvasItem } from "../../utils/useCanvasItem";
import { useLongPressSelect } from "../../utils/useLongPressSelect";
import styles from "./LiveTrackerWidget.module.css";

export const LIVE_TRACKER_GRID_SIZE = 20;

interface LiveTrackerWidgetProps {
  x: number;
  y: number;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  onResizingChange: (resizing: boolean) => void;
  children: ReactNode;
  // Only the signed-in owner can drag/resize - public visitors get a plain
  // positioned card rendering the same saved layout read-only, since there's
  // no per-visitor preference here (see LiveTrackerLayout in
  // api/live-tracker.ts).
  interactive: boolean;
  // Phone/tablet: full-width in normal document flow instead of absolutely
  // positioned - same pattern as DashboardWidget/CoachingWidget.
  stacked?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onReorder?: (direction: "up" | "down") => void;
}

// No remove/hide control, unlike DashboardWidget/CoachingWidget - the Live
// Tracker page always shows the same fixed set of cards (stats, progress,
// map, eta, weather), there's no catalog to re-add from, so only position
// and size are ever adjustable.
export default function LiveTrackerWidget({
  x,
  y,
  width,
  height,
  minWidth,
  minHeight,
  onMove,
  onResize,
  onResizingChange,
  children,
  interactive,
  stacked,
  canMoveUp,
  canMoveDown,
  onReorder,
}: LiveTrackerWidgetProps) {
  const { rect, handleDragPointerDown, handleResizePointerDown } = useCanvasItem({
    initial: { x, y, width, height },
    minWidth,
    minHeight,
    gridSize: LIVE_TRACKER_GRID_SIZE,
    onMove,
    onResize,
    onDraggingChange: onResizingChange,
  });

  // Same 3-second hold-to-select as Dashboard/Trends/Coaching's widgets
  // (see useLongPressSelect) - drag/resize/reorder chrome only appears
  // once the widget is actually selected, not on every plain tap.
  const { ref: widgetRef, selected, pressHandlers } = useLongPressSelect<HTMLDivElement>();

  const effective = interactive ? rect : { x, y, width, height };
  const positionStyle = stacked
    ? { width: effective.width, height: effective.height }
    : { position: "absolute" as const, left: effective.x, top: effective.y, width: effective.width, height: effective.height };

  if (!interactive) {
    return (
      <div className={`${styles.widget} ${stacked ? styles.stacked : ""}`} style={positionStyle}>
        <div className={styles.content}>{children}</div>
      </div>
    );
  }

  return (
    <div
      ref={widgetRef}
      className={`${styles.widget} ${styles.editable} ${stacked ? styles.stacked : ""}`}
      style={positionStyle}
      data-selected={selected || undefined}
      {...pressHandlers}
    >
      <div className={styles.dragHandle} onPointerDown={handleDragPointerDown} role="button" tabIndex={0} aria-label="Drag to move">
        ⠿
      </div>
      {stacked && (
        <div className={styles.controls}>
          <button type="button" className={styles.iconButton} onClick={() => onReorder?.("up")} disabled={!canMoveUp} aria-label="Move widget up">
            ▲
          </button>
          <button type="button" className={styles.iconButton} onClick={() => onReorder?.("down")} disabled={!canMoveDown} aria-label="Move widget down">
            ▼
          </button>
        </div>
      )}
      <div className={styles.content}>{children}</div>
      <div className={styles.resizeHandle} onPointerDown={handleResizePointerDown} role="button" tabIndex={0} aria-label="Drag to resize">
        ⌟
      </div>
    </div>
  );
}
