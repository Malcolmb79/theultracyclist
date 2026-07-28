export interface FittableRect {
  x?: number;
  width?: number;
}

// Proportionally stretches a set of absolutely-positioned widgets'
// horizontal x/width so they fill more of the available canvas width -
// pairs with widening the canvas itself (see *.module.css's max-width),
// since existing saved widget positions don't automatically grow to fill
// newly available room on their own (they're free-form x/y/width/height,
// not a responsive grid). Only ever stretches, never shrinks, and snaps to
// the same grid each page's own drag/resize already uses, so the result
// still lines up with that grid instead of landing at odd fractional
// pixel positions. Heights are left untouched - this is about using more
// horizontal space, not distorting chart proportions.
export function fitWidgetsToWidth<T extends FittableRect>(
  widgets: T[],
  availableWidth: number,
  gridSize: number,
  minWidthFor: (widget: T) => number,
): T[] {
  if (widgets.length === 0) return widgets;
  const rightmostExtent = Math.max(...widgets.map((w) => (w.x ?? 0) + (w.width ?? 0)));
  if (rightmostExtent <= 0) return widgets;

  const scale = availableWidth / rightmostExtent;
  if (scale <= 1) return widgets;

  return widgets.map((w) => {
    const x = w.x ?? 0;
    const width = w.width ?? 0;
    const newWidth = Math.max(minWidthFor(w), Math.round((width * scale) / gridSize) * gridSize);
    const newX = Math.round((x * scale) / gridSize) * gridSize;
    return { ...w, x: newX, width: newWidth };
  });
}
