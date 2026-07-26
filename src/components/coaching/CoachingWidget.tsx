import type { ReactNode } from "react";
import { useCanvasItem } from "../../utils/useCanvasItem";
import { useLongPressSelect } from "../../utils/useLongPressSelect";
import styles from "./CoachingWidget.module.css";

export const COACHING_WIDGET_GRID_SIZE = 20;

interface CoachingWidgetProps {
  x: number;
  y: number;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  onResizingChange: (resizing: boolean) => void;
  onRemove: () => void;
  children: ReactNode;
  // Phone/tablet layout: full-width in normal document flow instead of
  // absolutely positioned at x/y - see DashboardWidget's identical prop.
  stacked?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onReorder?: (direction: "up" | "down") => void;
}

// A thin positioning shell around each coaching card - unlike the
// Dashboard/Trends widgets, these don't have a swappable metric, just a
// free position, size, and (now) a removable identity. The card itself
// supplies all its own visual chrome (background, border, padding, its own
// title); this wrapper stays visually transparent and only adds floating
// drag/resize/remove/reorder controls above it, rather than a full header
// bar that would duplicate the card's own title.
export default function CoachingWidget({
  x,
  y,
  width,
  height,
  minWidth,
  minHeight,
  onMove,
  onResize,
  onResizingChange,
  onRemove,
  children,
  stacked,
  canMoveUp,
  canMoveDown,
  onReorder,
}: CoachingWidgetProps) {
  const { rect, handleDragPointerDown, handleResizePointerDown } = useCanvasItem({
    initial: { x, y, width, height },
    minWidth,
    minHeight,
    gridSize: COACHING_WIDGET_GRID_SIZE,
    onMove,
    onResize,
    onDraggingChange: onResizingChange,
  });

  const { ref: widgetRef, selected, pressHandlers } = useLongPressSelect<HTMLDivElement>();

  const positionStyle = stacked
    ? { width: rect.width, height: rect.height }
    : { position: "absolute" as const, left: rect.x, top: rect.y, width: rect.width, height: rect.height };

  return (
    <div
      ref={widgetRef}
      className={`${styles.widget} ${stacked ? styles.stacked : ""}`}
      style={positionStyle}
      data-selected={selected || undefined}
      {...pressHandlers}
    >
      {!stacked && (
        <div className={styles.dragHandle} onPointerDown={handleDragPointerDown} role="button" tabIndex={0} aria-label="Drag to move">
          ⠿
        </div>
      )}
      <div className={styles.controls}>
        {stacked && (
          <>
            <button type="button" className={styles.iconButton} onClick={() => onReorder?.("up")} disabled={!canMoveUp} aria-label="Move widget up">
              ▲
            </button>
            <button type="button" className={styles.iconButton} onClick={() => onReorder?.("down")} disabled={!canMoveDown} aria-label="Move widget down">
              ▼
            </button>
          </>
        )}
        <button
          type="button"
          className={styles.iconButton}
          onClick={(e) => {
            // Blur before removing - on iOS Safari, removing the still-
            // focused button from the DOM makes focus fall back to <body>,
            // which scrolls the whole page to the top instead of leaving
            // the scroll position where it was.
            e.currentTarget.blur();
            onRemove();
          }}
          aria-label="Remove widget"
        >
          ×
        </button>
      </div>
      <div className={styles.content}>{children}</div>
      <div
        className={styles.resizeHandle}
        onPointerDown={handleResizePointerDown}
        role="button"
        tabIndex={0}
        aria-label="Drag to resize"
      >
        ⌟
      </div>
    </div>
  );
}
