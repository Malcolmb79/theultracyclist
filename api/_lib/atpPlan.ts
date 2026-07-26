// The athlete's real TrainingPeaks Annual Training Plan (ATP), entered
// manually from their own TrainingPeaks account (no live TrainingPeaks API
// integration exists here - see CLAUDE.md/coachContext.ts's SEASON_PLAN for
// why). Each entry is one Monday-start training week's planned TSS and the
// resulting target CTL (fitness)/TSB (form) TrainingPeaks itself computed
// for that week under its own model - not recomputed from tssTarget here,
// since matching TrainingPeaks' own numbers exactly (rather than
// approximating them a second time) is the point of a target comparison.
// Update this array directly if the athlete's real ATP changes.
export type AtpWeek = {
  weekStart: string; // YYYY-MM-DD, Monday
  tssTarget: number;
  ctlTarget: number;
  tsbTarget: number;
};

export const ATP_PLAN: AtpWeek[] = [
  { weekStart: "2026-07-27", tssTarget: 300, ctlTarget: 18, tsbTarget: -21 },
  { weekStart: "2026-08-03", tssTarget: 400, ctlTarget: 24, tsbTarget: -27 },
  { weekStart: "2026-08-10", tssTarget: 450, ctlTarget: 30, tsbTarget: -30 },
  { weekStart: "2026-08-17", tssTarget: 500, ctlTarget: 36, tsbTarget: -31 },
  { weekStart: "2026-08-24", tssTarget: 400, ctlTarget: 40, tsbTarget: -22 },
  { weekStart: "2026-08-31", tssTarget: 550, ctlTarget: 46, tsbTarget: -27 },
  { weekStart: "2026-09-07", tssTarget: 600, ctlTarget: 52, tsbTarget: -29 },
  { weekStart: "2026-09-14", tssTarget: 650, ctlTarget: 58, tsbTarget: -31 },
  { weekStart: "2026-09-21", tssTarget: 700, ctlTarget: 65, tsbTarget: -32 },
  { weekStart: "2026-09-28", tssTarget: 640, ctlTarget: 69, tsbTarget: -25 },
  { weekStart: "2026-10-05", tssTarget: 760, ctlTarget: 75, tsbTarget: -28 },
  { weekStart: "2026-10-12", tssTarget: 880, ctlTarget: 83, tsbTarget: -35 },
  { weekStart: "2026-10-19", tssTarget: 640, ctlTarget: 84, tsbTarget: -18 },
  { weekStart: "2026-10-26", tssTarget: 760, ctlTarget: 88, tsbTarget: -18 },
  { weekStart: "2026-11-02", tssTarget: 880, ctlTarget: 94, tsbTarget: -25 },
  { weekStart: "2026-11-09", tssTarget: 640, ctlTarget: 93, tsbTarget: -9 },
  { weekStart: "2026-11-16", tssTarget: 760, ctlTarget: 96, tsbTarget: -10 },
  { weekStart: "2026-11-23", tssTarget: 880, ctlTarget: 100, tsbTarget: -18 },
  { weekStart: "2026-11-30", tssTarget: 640, ctlTarget: 99, tsbTarget: -3 },
  { weekStart: "2026-12-07", tssTarget: 880, ctlTarget: 103, tsbTarget: -13 },
  { weekStart: "2026-12-14", tssTarget: 1000, ctlTarget: 109, tsbTarget: -24 },
  { weekStart: "2026-12-21", tssTarget: 640, ctlTarget: 107, tsbTarget: -1 },
  { weekStart: "2026-12-28", tssTarget: 880, ctlTarget: 110, tsbTarget: -9 },
  { weekStart: "2027-01-04", tssTarget: 1000, ctlTarget: 115, tsbTarget: -19 },
  { weekStart: "2027-01-11", tssTarget: 640, ctlTarget: 111, tsbTarget: 3 },
  { weekStart: "2027-01-18", tssTarget: 880, ctlTarget: 113, tsbTarget: -5 },
  { weekStart: "2027-01-25", tssTarget: 1000, ctlTarget: 118, tsbTarget: -16 },
  { weekStart: "2027-02-01", tssTarget: 640, ctlTarget: 114, tsbTarget: 6 },
  { weekStart: "2027-02-08", tssTarget: 880, ctlTarget: 116, tsbTarget: -3 },
  { weekStart: "2027-02-15", tssTarget: 1000, ctlTarget: 120, tsbTarget: -14 },
  { weekStart: "2027-02-22", tssTarget: 640, ctlTarget: 115, tsbTarget: 7 },
  { weekStart: "2027-03-01", tssTarget: 880, ctlTarget: 117, tsbTarget: -1 },
  { weekStart: "2027-03-08", tssTarget: 1000, ctlTarget: 121, tsbTarget: -13 },
  { weekStart: "2027-03-15", tssTarget: 640, ctlTarget: 116, tsbTarget: 8 },
  { weekStart: "2027-03-22", tssTarget: 1000, ctlTarget: 121, tsbTarget: -8 },
  { weekStart: "2027-03-29", tssTarget: 1000, ctlTarget: 124, tsbTarget: -14 },
  { weekStart: "2027-04-05", tssTarget: 640, ctlTarget: 119, tsbTarget: 9 },
  { weekStart: "2027-04-12", tssTarget: 1080, ctlTarget: 124, tsbTarget: -12 },
  { weekStart: "2027-04-19", tssTarget: 1080, ctlTarget: 129, tsbTarget: -20 },
  { weekStart: "2027-04-26", tssTarget: 640, ctlTarget: 123, tsbTarget: 10 },
  { weekStart: "2027-05-03", tssTarget: 1080, ctlTarget: 128, tsbTarget: -10 },
  { weekStart: "2027-05-10", tssTarget: 1080, ctlTarget: 132, tsbTarget: -17 },
  { weekStart: "2027-05-17", tssTarget: 640, ctlTarget: 126, tsbTarget: 12 },
  { weekStart: "2027-05-24", tssTarget: 760, ctlTarget: 123, tsbTarget: 14 },
  { weekStart: "2027-05-31", tssTarget: 640, ctlTarget: 118, tsbTarget: 20 },
  // Race week - "World Record Ultra" (the Ireland north-south unsupported record attempt).
  { weekStart: "2027-06-07", tssTarget: 640, ctlTarget: 114, tsbTarget: 21 },
  { weekStart: "2027-06-14", tssTarget: 0, ctlTarget: 96, tsbTarget: 62 },
  { weekStart: "2027-06-21", tssTarget: 640, ctlTarget: 96, tsbTarget: 28 },
  { weekStart: "2027-06-28", tssTarget: 1000, ctlTarget: 103, tsbTarget: -12 },
  { weekStart: "2027-07-05", tssTarget: 1000, ctlTarget: 109, tsbTarget: -25 },
  { weekStart: "2027-07-12", tssTarget: 640, ctlTarget: 106, tsbTarget: -2 },
  { weekStart: "2027-07-19", tssTarget: 1080, ctlTarget: 114, tsbTarget: -22 },
  { weekStart: "2027-07-26", tssTarget: 1080, ctlTarget: 120, tsbTarget: -29 },
  { weekStart: "2027-08-02", tssTarget: 640, ctlTarget: 116, tsbTarget: 2 },
  { weekStart: "2027-08-09", tssTarget: 1080, ctlTarget: 122, tsbTarget: -16 },
  { weekStart: "2027-08-16", tssTarget: 1080, ctlTarget: 127, tsbTarget: -22 },
  { weekStart: "2027-08-23", tssTarget: 640, ctlTarget: 121, tsbTarget: 8 },
];

// Monday-start week boundary matching this plan's own convention (and the
// athlete's - see ATHLETE_PROFILE in coachContext.ts).
function startOfWeek(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d.toISOString().slice(0, 10);
}

export function getAtpWeekFor(dateStr: string): AtpWeek | null {
  const weekStart = startOfWeek(dateStr);
  return ATP_PLAN.find((w) => w.weekStart === weekStart) ?? null;
}
