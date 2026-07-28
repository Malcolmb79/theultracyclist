export interface FittableRect {
  x?: number;
  width?: number;
}

// Proportionally stretches a set of absolutely-positioned widgets'
// horizontal x/width so they fill more of the available canvas width -
// pairs with widening the canvas itself (see *.module.css's max-width),
// since existing saved widget positions don't automatically grow to fill
// newly available room on their own (they're free-form x/y/width/height,
// not a responsive grid). Never shrinks below the widgets' current extent
// (scale is clamped to a 1x floor) - so re-running this after the canvas
// hasn't grown further is still safe, and doubles as a pure column-
// realignment pass (see the grouping step below) rather than a no-op.
// Snaps to the same grid each page's own drag/resize already uses, so the
// result still lines up with that grid instead of landing at odd
// fractional pixel positions. Heights are left untouched - this is about
// using more horizontal space, not distorting chart proportions.
export function fitWidgetsToWidth<T extends FittableRect>(
  widgets: T[],
  availableWidth: number,
  gridSize: number,
  minWidthFor: (widget: T) => number,
): T[] {
  if (widgets.length === 0) return widgets;
  const rightmostExtent = Math.max(...widgets.map((w) => (w.x ?? 0) + (w.width ?? 0)));
  if (rightmostExtent <= 0) return widgets;

  const scale = Math.max(1, availableWidth / rightmostExtent);

  // Widgets whose left edges are already within one grid cell of each other
  // read as a single visual column, even though their x values aren't
  // necessarily bit-for-bit equal (a widget dragged/resized independently
  // can land a few px off from its neighbor). Scaling each widget's x in
  // isolation stretches that small original offset by the same factor,
  // then snapping each to the grid independently can round two
  // once-adjacent widgets into different grid cells - turning an invisible
  // few-pixel gap into a visibly uneven one. Grouping first and giving every
  // member of a group the same new x keeps columns that lined up before
  // still lining up after.
  const xs = [...new Set(widgets.map((w) => w.x ?? 0))].sort((a, b) => a - b);
  const scaledXFor = new Map<number, number>();
  let groupOriginX = -Infinity;
  let groupNewX = 0;
  for (const x of xs) {
    if (x - groupOriginX > gridSize) {
      groupOriginX = x;
      groupNewX = Math.round((x * scale) / gridSize) * gridSize;
    }
    scaledXFor.set(x, groupNewX);
  }

  return widgets.map((w) => {
    const width = w.width ?? 0;
    const newWidth = Math.max(minWidthFor(w), Math.round((width * scale) / gridSize) * gridSize);
    const newX = scaledXFor.get(w.x ?? 0)!;
    return { ...w, x: newX, width: newWidth };
  });
}
