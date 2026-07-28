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
// hasn't grown further is still safe, and doubles as a pure realignment
// pass rather than a no-op. Heights are left untouched - this is about
// using more horizontal space, not distorting chart proportions.
//
// Widgets are grouped into "columns" by left edge (within one grid cell -
// independently dragged/resized widgets rarely land bit-for-bit on the
// same x). Every member of a column shares one new x, so a column that
// lined up before stays lined up after. The gap between adjacent columns
// is computed ONCE (the median of the original gaps, scaled) and reused
// identically at every boundary, rather than falling out of each column's
// own independently-rounded position - rounding x and width to the grid
// separately for every column let small rounding errors compound
// differently at each boundary, which is what made the gaps between
// columns come out visibly uneven after a stretch.
export function fitWidgetsToWidth<T extends FittableRect>(
  widgets: T[],
  availableWidth: number,
  gridSize: number,
  minWidthFor: (widget: T) => number,
): T[] {
  if (widgets.length === 0) return widgets;

  const sorted = [...widgets].sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
  const columns: { x: number; width: number; members: T[] }[] = [];
  for (const w of sorted) {
    const x = w.x ?? 0;
    const width = w.width ?? 0;
    const last = columns[columns.length - 1];
    if (last && x - last.x <= gridSize) {
      last.members.push(w);
      last.width = Math.max(last.width, width);
    } else {
      columns.push({ x, width, members: [w] });
    }
  }

  const totalColumnWidth = columns.reduce((sum, c) => sum + c.width, 0);
  if (totalColumnWidth <= 0) return widgets;

  // The gap this layout already had between columns, so the fixed version
  // reuses the same spacing rather than inventing an arbitrary new one -
  // just applied uniformly everywhere instead of independently per
  // boundary. Median rather than average/first so one already-odd gap
  // (e.g. two columns that happen to overlap slightly) doesn't skew the
  // gap used for every other boundary.
  const originalGaps: number[] = [];
  for (let i = 0; i < columns.length - 1; i++) {
    originalGaps.push(Math.max(0, columns[i + 1].x - (columns[i].x + columns[i].width)));
  }
  originalGaps.sort((a, b) => a - b);
  const targetGap = originalGaps.length > 0 ? originalGaps[Math.floor(originalGaps.length / 2)] : gridSize;

  const gapCount = columns.length - 1;
  const rawScale = availableWidth / (totalColumnWidth + gapCount * targetGap);
  const scale = Math.max(1, rawScale);
  const scaledGap = Math.round((targetGap * scale) / gridSize) * gridSize;

  const newColumnX: number[] = [];
  let cursor = Math.round((columns[0].x * scale) / gridSize) * gridSize;
  for (const column of columns) {
    newColumnX.push(cursor);
    const newWidth = Math.round((column.width * scale) / gridSize) * gridSize;
    cursor += newWidth + scaledGap;
  }

  const columnIndexByWidget = new Map<T, number>();
  columns.forEach((column, index) => {
    for (const member of column.members) columnIndexByWidget.set(member, index);
  });

  return widgets.map((w) => {
    const width = w.width ?? 0;
    const newWidth = Math.max(minWidthFor(w), Math.round((width * scale) / gridSize) * gridSize);
    const newX = newColumnX[columnIndexByWidget.get(w)!];
    return { ...w, x: newX, width: newWidth };
  });
}
