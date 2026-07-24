// Whoop's own recovery banding: green 67-100, yellow 34-66, red 0-33.
export function recoveryColor(score: number): string {
  if (score >= 67) return "var(--color-accent-2)";
  if (score >= 34) return "var(--color-amber)";
  return "var(--color-accent)";
}
