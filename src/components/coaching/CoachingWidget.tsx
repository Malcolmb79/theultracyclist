import { useEffect, useRef, useState, type ReactNode } from "react";
import { useCanvasItem } from "../../utils/useCanvasItem";
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
  children: ReactNode;
}

// A thin positioning shell around each fixed coaching card - unlike the
// Dashboard/Trends widgets, these don't have a swappable metric or a
// removable identity, just a free position and size. The card itself
// supplies all its own visual chrome (background, border, padding); this
// wrapper stays visually transparent and only adds the drag/resize handles.
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
  children,
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

  const [selected, setSelected] = useState(false);
  const widgetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selected) return;
    const handleOutside = (e: PointerEvent) => {
      if (widgetRef.current && !widgetRef.current.contains(e.target as Node)) {
        setSelected(false);
      }
    };
    document.addEventListener("pointerdown", handleOutside);
    return () => document.removeEventListener("pointerdown", handleOutside);
  }, [selected]);

  return (
    <div
      ref={widgetRef}
      className={styles.widget}
      style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      data-selected={selected || undefined}
      onPointerDownCapture={() => setSelected(true)}
    >
      <div className={styles.dragHandle} onPointerDown={handleDragPointerDown} role="button" tabIndex={0} aria-label="Drag to move">
        ⠿
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
