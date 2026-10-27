import type { XmlNode } from "./workoutPlan";

// Shared by the workout strip and panel: the example workout to place them
// by, and how their times are written.

export function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** The example: over-unders, part-way through the second recovery with the countdown running. */
export const EXAMPLE_FILE: XmlNode = {
  type: "element",
  name: "workout_file",
  children: [
    { type: "element", name: "name", children: [{ type: "text", text: "Over-unders 4×1" }] },
    {
      type: "element",
      name: "workout",
      children: [
        { type: "element", name: "Warmup", attributes: { Duration: "600", PowerLow: "0.5", PowerHigh: "0.75" } },
        { type: "element", name: "SteadyState", attributes: { Duration: "300", Power: "0.65" } },
        { type: "element", name: "IntervalsT", attributes: { Repeat: "4", OnDuration: "60", OffDuration: "60", OnPower: "1.05", OffPower: "0.9" } },
        { type: "element", name: "SteadyState", attributes: { Duration: "240", Power: "0.55" } },
        { type: "element", name: "IntervalsT", attributes: { Repeat: "4", OnDuration: "60", OffDuration: "60", OnPower: "1.05", OffPower: "0.9" } },
        { type: "element", name: "FreeRide", attributes: { Duration: "180" } },
        { type: "element", name: "Cooldown", attributes: { Duration: "480", PowerLow: "0.6", PowerHigh: "0.4" } },
      ],
    },
  ],
};
export const EXAMPLE_AT = 1134;
