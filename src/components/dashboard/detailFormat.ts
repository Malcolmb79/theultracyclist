export function average(values: (number | null | undefined)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

export function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

export function qualityBand(percent: number): { label: string; color: string } {
  if (percent >= 85) return { label: "Optimal", color: "var(--color-accent-2)" };
  if (percent >= 50) return { label: "Sufficient", color: "var(--color-text-muted)" };
  return { label: "Poor", color: "var(--color-amber)" };
}
