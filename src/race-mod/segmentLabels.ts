import type { RouteSegment, SegmentKind } from "../components/race/courseMap";

// Laying out segment names over the profile without them piling up. On a
// lap route, or a stretch where segments come thick and fast, putting each
// name at its segment's start runs them into one another until the top of
// the chart is an unreadable smear. Here the same segment listed more than
// once is shown once, a name that comes round again (every lap) is named
// only where the rider next meets it, climbs and sprints get first pick of
// the space, each name takes the first free row, and a name with no room is
// left off rather than drawn over another (its shading still shows where
// it is).

export interface PlacedLabel {
  seg: RouteSegment;
  /** Left edge of the label, px from the chart's left. */
  left: number;
  row: number;
}

/** Climbs and sprints are named before plain segments. */
const PRIORITY: Record<SegmentKind, number> = { climb: 0, sprint: 1, segment: 2 };

/**
 * The segments with repeats folded together: the same segment listed again
 * where it overlaps or nearly touches itself (Sauce can list a segment once
 * per road it crosses) becomes one stretch.
 */
export function mergeSegments(segs: RouteSegment[], gapM = 50): RouteSegment[] {
  const sorted = [...segs].sort((a, b) => a.start - b.start);
  const out: RouteSegment[] = [];
  for (const s of sorted) {
    const prev = out.findLast((o) => o.name === s.name && o.kind === s.kind);
    if (prev && s.start <= prev.end + gapM) prev.end = Math.max(prev.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

/**
 * Where each name goes. `x` turns metres along the route into px across the
 * chart; `measure` gives a name's width in px.
 */
export function layoutLabels(
  segs: RouteSegment[],
  x: (d: number) => number,
  width: number,
  measure: (text: string) => number,
  { rows = 2, gap = 8, from = -Infinity, at }: { rows?: number; gap?: number; from?: number; at?: number } = {},
): PlacedLabel[] {
  // Each name once: the first not yet ridden past, or the last if all are.
  const byName = new Map<string, RouteSegment>();
  for (const s of [...segs].sort((a, b) => a.start - b.start)) {
    const kept = byName.get(s.name);
    if (!kept || (at != null && kept.end < at)) byName.set(s.name, s);
  }
  const taken: [number, number][][] = Array.from({ length: rows }, () => []);
  const order = [...byName.values()].sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || a.start - b.start);
  const placed: PlacedLabel[] = [];
  for (const seg of order) {
    const w = measure(seg.name);
    if (w > width) continue;
    // From the segment's start (or the chart's edge), kept inside the chart.
    const left = Math.max(0, Math.min(width - w, x(Math.max(seg.start, from)) + 2));
    const right = left + w;
    const row = taken.findIndex((spans) => spans.every(([a, b]) => right + gap <= a || left >= b + gap));
    if (row < 0) continue;
    taken[row].push([left, right]);
    placed.push({ seg, left, row });
  }
  return placed;
}
