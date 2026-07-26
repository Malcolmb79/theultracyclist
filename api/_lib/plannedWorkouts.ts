import { getJSON, setJSON } from "./kvStore.js";

// A single interval step, or a repeated block of steps (one level of
// nesting - covers the overwhelming majority of real interval sessions,
// "N x (work + rest)", without the complexity of arbitrarily nested
// structures a full workout-builder format would need).
export type WorkoutStep = {
  name?: string;
  durationSeconds: number;
  // Percent of FTP (when primaryIntensityMetric is "percentOfFtp") or
  // percent of threshold HR (when "percentOfThresholdHr") - omitted
  // entirely for a plain RPE/description-only step.
  intensityMin?: number;
  intensityMax?: number;
  intensityClass?: "warmUp" | "active" | "rest" | "coolDown";
};

export type WorkoutStepGroup = ({ type?: "step" } & WorkoutStep) | { type: "repetition"; reps: number; name?: string; steps: WorkoutStep[] };

export type PlannedWorkout = {
  id: string;
  // YYYY-MM-DD for an all-day plan, or YYYY-MM-DDTHH:MM:SS for a specific
  // planned start time - mirrors how TrainingPeaks itself splits these.
  date: string;
  sport: "Bike" | "Run" | "Strength" | "Other";
  title: string;
  description?: string;
  primaryIntensityMetric?: "percentOfFtp" | "percentOfThresholdHr";
  steps?: WorkoutStepGroup[];
  // Derived from steps when primaryIntensityMetric is "percentOfFtp" and
  // the athlete's FTP is set (see computeStructureSummary) - explicit
  // values here always win over derived ones, matching tp-mcp's own
  // "pass them explicitly to override" behaviour.
  durationMinutes?: number;
  tssPlanned?: number;
  ifPlanned?: number;
  createdAt: string;
  updatedAt: string;
};

const KV_KEY = "PLANNED_WORKOUTS";

function flattenSteps(groups: WorkoutStepGroup[]): WorkoutStep[] {
  return groups.flatMap((g) => (g.type === "repetition" ? Array.from({ length: g.reps }, () => g.steps).flat() : [g]));
}

// Estimates duration/IF/TSS from a %FTP-based structure - each leaf step's
// intensity midpoint is treated as that segment's average power (as a
// fraction of FTP), matching the standard planned-TSS approximation used
// by most training-plan tools (this is an estimate for planning purposes,
// not a substitute for a real recorded ride's measured TSS).
export function computeStructureSummary(
  workout: Pick<PlannedWorkout, "steps" | "primaryIntensityMetric">,
): { durationMinutes: number; tssPlanned: number; ifPlanned: number } | null {
  if (!workout.steps?.length || workout.primaryIntensityMetric !== "percentOfFtp") return null;

  const steps = flattenSteps(workout.steps);
  const totalSeconds = steps.reduce((sum, s) => sum + s.durationSeconds, 0);
  if (totalSeconds === 0) return null;

  let weightedTss = 0;
  for (const step of steps) {
    const min = step.intensityMin ?? 0;
    const max = step.intensityMax ?? min;
    const avgIntensity = (min + max) / 2 / 100; // fraction of FTP
    const hours = step.durationSeconds / 3600;
    weightedTss += hours * avgIntensity * avgIntensity * 100;
  }

  // A single representative IF for the whole session: back-derive it from
  // total TSS and total duration rather than a plain average of per-step
  // intensities, so it reflects the actual work distribution (harder
  // segments count for more).
  const totalHours = totalSeconds / 3600;
  const ifPlanned = Math.sqrt(weightedTss / (totalHours * 100));

  return {
    durationMinutes: Math.round(totalSeconds / 60),
    tssPlanned: Math.round(weightedTss * 10) / 10,
    ifPlanned: Math.round(ifPlanned * 100) / 100,
  };
}

async function readAll(): Promise<PlannedWorkout[]> {
  return (await getJSON<PlannedWorkout[]>(KV_KEY)) ?? [];
}

export async function listPlannedWorkouts(from?: string, to?: string): Promise<PlannedWorkout[]> {
  const all = await readAll();
  const filtered = all.filter((w) => (!from || w.date >= from) && (!to || w.date <= `${to}T99:99:99`));
  return filtered.sort((a, b) => a.date.localeCompare(b.date));
}

export async function getPlannedWorkout(id: string): Promise<PlannedWorkout | null> {
  const all = await readAll();
  return all.find((w) => w.id === id) ?? null;
}

export async function createPlannedWorkout(
  input: Omit<PlannedWorkout, "id" | "createdAt" | "updatedAt" | "durationMinutes" | "tssPlanned" | "ifPlanned"> &
    Partial<Pick<PlannedWorkout, "durationMinutes" | "tssPlanned" | "ifPlanned">>,
): Promise<PlannedWorkout> {
  const derived = computeStructureSummary(input);
  const now = new Date().toISOString();
  const workout: PlannedWorkout = {
    ...input,
    id: `pw_${Date.now()}_${Math.round(Math.random() * 1e6)}`,
    durationMinutes: input.durationMinutes ?? derived?.durationMinutes,
    tssPlanned: input.tssPlanned ?? derived?.tssPlanned,
    ifPlanned: input.ifPlanned ?? derived?.ifPlanned,
    createdAt: now,
    updatedAt: now,
  };
  const all = await readAll();
  await setJSON(KV_KEY, [...all, workout]);
  return workout;
}

export async function updatePlannedWorkout(id: string, patch: Partial<PlannedWorkout>): Promise<PlannedWorkout | null> {
  const all = await readAll();
  const index = all.findIndex((w) => w.id === id);
  if (index === -1) return null;

  const merged = { ...all[index], ...patch, id, updatedAt: new Date().toISOString() };
  // Re-derive from the structure whenever it changed and the caller didn't
  // also explicitly override the derived fields in this same patch.
  if (patch.steps || patch.primaryIntensityMetric) {
    const derived = computeStructureSummary(merged);
    if (derived) {
      if (patch.durationMinutes == null) merged.durationMinutes = derived.durationMinutes;
      if (patch.tssPlanned == null) merged.tssPlanned = derived.tssPlanned;
      if (patch.ifPlanned == null) merged.ifPlanned = derived.ifPlanned;
    }
  }

  all[index] = merged;
  await setJSON(KV_KEY, all);
  return merged;
}

export async function deletePlannedWorkout(id: string): Promise<boolean> {
  const all = await readAll();
  const next = all.filter((w) => w.id !== id);
  if (next.length === all.length) return false;
  await setJSON(KV_KEY, next);
  return true;
}
