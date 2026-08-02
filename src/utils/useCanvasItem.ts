import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface UseCanvasItemArgs {
  initial: CanvasRect;
  minWidth: number;
  minHeight: number;
  gridSize: number;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  onDraggingChange?: (dragging: boolean) => void;
}

function snap(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

// Shared window-level pointer tracking plus a body scroll lock for the
// duration of the drag. Window listeners (rather than relying solely on the
// handle's own onPointerMove/onPointerUp + pointer capture) plus the lock
// keep iOS Safari from reinterpreting a drag as a page-scroll gesture
// partway through, even when it starts on a small handle.
function trackPointer(
  startEvent: ReactPointerEvent,
  onStep: (dx: number, dy: number) => void,
  onFinish: () => void,
  onDraggingChange?: (dragging: boolean) => void,
) {
  startEvent.stopPropagation();
  startEvent.preventDefault();

  const startX = startEvent.clientX;
  const startY = startEvent.clientY;
  onDraggingChange?.(true);

  const previousBodyOverflow = document.body.style.overflow;
  const previousBodyTouchAction = document.body.style.touchAction;
  document.body.style.overflow = "hidden";
  document.body.style.touchAction = "none";

  const handleMove = (moveEvent: PointerEvent) => {
    moveEvent.preventDefault();
    onStep(moveEvent.clientX - startX, moveEvent.clientY - startY);
  };

  const finish = () => {
    onDraggingChange?.(false);
    document.body.style.overflow = previousBodyOverflow;
    document.body.style.touchAction = previousBodyTouchAction;
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    onFinish();
  };

  window.addEventListener("pointermove", handleMove, { passive: false });
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
}

// Drives a freely-positioned, freely-sized canvas item: a drag handle moves
// it (x/y, clamped to stay on-canvas), a corner handle resizes it (width/
// height, floored at the given minimums). Both snap to the same grid and
// report back to the caller only once the gesture ends - the rect returned
// here is the live, in-drag value for rendering.
export function useCanvasItem({
  initial,
  minWidth,
  minHeight,
  gridSize,
  onMove,
  onResize,
  onDraggingChange,
}: UseCanvasItemArgs) {
  const [rect, setRect] = useState<CanvasRect>(initial);
  const liveRect = useRef(rect);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const resizeStart = useRef<{ width: number; height: number } | null>(null);

  // `initial` seeds state, so without this the rendered rect was frozen at
  // whatever the caller passed on first mount and no later change could
  // reach it. That's fine while the only thing moving a widget is its own
  // drag handle, but not once the caller scales the whole canvas to fit
  // the window (see LiveTrackerPage's fit factor) - resizing the browser
  // would recompute every rect and none of them would move. Skipped
  // mid-gesture so an in-flight drag isn't yanked back by a re-render.
  useEffect(() => {
    if (dragStart.current || resizeStart.current) return;
    const next = { x: initial.x, y: initial.y, width: initial.width, height: initial.height };
    liveRect.current = next;
    setRect(next);
  }, [initial.x, initial.y, initial.width, initial.height]);

  const handleDragPointerDown = (e: ReactPointerEvent) => {
    dragStart.current = { x: rect.x, y: rect.y };
    trackPointer(
      e,
      (dx, dy) => {
        if (!dragStart.current) return;
        const next = {
          ...liveRect.current,
          x: Math.max(0, snap(dragStart.current.x + dx, gridSize)),
          y: Math.max(0, snap(dragStart.current.y + dy, gridSize)),
        };
        liveRect.current = next;
        setRect(next);
      },
      () => {
        dragStart.current = null;
        onMove(Math.round(liveRect.current.x), Math.round(liveRect.current.y));
      },
      onDraggingChange,
    );
  };

  const handleResizePointerDown = (e: ReactPointerEvent) => {
    resizeStart.current = { width: rect.width, height: rect.height };
    trackPointer(
      e,
      (dx, dy) => {
        if (!resizeStart.current) return;
        const next = {
          ...liveRect.current,
          width: Math.max(minWidth, snap(resizeStart.current.width + dx, gridSize)),
          height: Math.max(minHeight, snap(resizeStart.current.height + dy, gridSize)),
        };
        liveRect.current = next;
        setRect(next);
      },
      () => {
        resizeStart.current = null;
        onResize(Math.round(liveRect.current.width), Math.round(liveRect.current.height));
      },
      onDraggingChange,
    );
  };

  // Imperative resize not driven by a drag gesture (e.g. bumping a widget
  // up to a new minimum size when its content type changes) - updates local
  // state and persists in one go, same as a drag's finish() would.
  const applyResize = (width: number, height: number) => {
    const next = { ...liveRect.current, width, height };
    liveRect.current = next;
    setRect(next);
    onResize(width, height);
  };

  return { rect, handleDragPointerDown, handleResizePointerDown, applyResize };
}

// Container height needs to be set explicitly since absolutely-positioned
// children don't contribute to their parent's natural size - this computes
// how tall the canvas needs to be to fit every item plus some breathing room.
export function computeCanvasHeight(rects: { y: number; height: number }[], minHeight = 400, padding = 40): number {
  const tallest = rects.reduce((max, r) => Math.max(max, r.y + r.height), 0);
  return Math.max(minHeight, tallest + padding);
}

// Every canvas is `max-width: min(95vw, 2400px)` in its page's stylesheet and
// never scrolls horizontally (see .canvas in DashboardPage/TrendsPage/
// CoachingPage.module.css). A widget saved beyond that width is therefore
// unreachable: it can't be seen, can't be dragged back, and can't be re-added
// - the catalog hides fixed cards that are already in the layout, so there was
// no way back at all short of reshuffling the whole canvas.
//
// Positions saved on a much wider screen (or by an earlier layout pass) could
// strand a card thousands of pixels out. The AI Coach card was found at
// x=4560 on a 1389px-wide window, which is what prompted this.
export const CANVAS_MAX_WIDTH = 2400;
const CANVAS_VIEWPORT_FRACTION = 0.95;

// How much of a widget has to remain on the canvas to count as reachable -
// enough to grab its header and drag it back.
const MIN_VISIBLE_WIDTH = 80;

export function usableCanvasWidth(viewportWidth: number = window.innerWidth): number {
  return Math.min(viewportWidth * CANVAS_VIEWPORT_FRACTION, CANVAS_MAX_WIDTH);
}

/**
 * Pulls a widget back onto the canvas if it is effectively off it.
 *
 * Deliberately conservative: anything with a usable amount of itself already
 * visible keeps its exact saved x, so a layout the athlete arranged on purpose
 * is never quietly rearranged. Only genuinely stranded widgets move, and they
 * move to the right-hand edge rather than to the origin, which keeps them
 * clear of whatever is already at the left.
 *
 * The clamp is applied when rendering rather than written back to storage, so
 * re-opening the same layout on a wide screen still shows the original
 * arrangement instead of one flattened by the narrowest screen ever used.
 */
export function rescueOffCanvasX(x: number, width: number, availableWidth: number): number {
  if (x + MIN_VISIBLE_WIDTH <= availableWidth) return x;
  return Math.max(0, availableWidth - width);
}
