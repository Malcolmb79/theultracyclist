import { formatElapsed } from "../components/race/raceLog";
import type { SauceAthleteData } from "../components/race/sauceFeed";
import { FIELD_GROUPS, RIDER_FIELDS, type FieldGroup, type RiderField } from "./riderFields";

// The numbers to choose from for a bar - Zwift's own ride numbers first,
// then everything Sauce knows about the rider - shared by Ride stats and the
// Top bar.

const eventMetres = (r: SauceAthleteData) => (r.state?.eventDistance && r.state.eventDistance > 0 ? r.state.eventDistance : r.state?.distance);

/** Zwift's own ride numbers, as it shows them top centre - first in the list to pick from. */
export const RIDE_FIELDS: RiderField[] = [
  { id: "speed", label: "Speed", short: "km/h", group: "Ride", value: (r) => r.state?.speed ?? undefined, show: (v) => String(Math.round(v)) },
  { id: "distance", label: "Distance", short: "km", group: "Ride", value: (r) => { const m = eventMetres(r); return m != null ? m / 1000 : undefined; }, show: (v) => v.toFixed(1) },
  { id: "climbing", label: "Climbing", short: "m", group: "Ride", value: (r) => r.state?.climbing ?? undefined, show: (v) => String(Math.round(v)) },
  { id: "time", label: "Time", short: "", group: "Ride", value: (r) => r.state?.time ?? undefined, show: (v) => formatElapsed(v * 1000) },
  { id: "gradient", label: "Gradient", short: "%", group: "Ride", value: (r) => (r.state?.grade != null ? r.state.grade * 100 : undefined), show: (v) => v.toFixed(1) },
  {
    id: "toGo",
    label: "Distance to go",
    short: "km to go",
    group: "Ride",
    value: (r) => (r.remainingMetric === "distance" && r.remaining != null ? r.remaining / 1000 : undefined),
    show: (v) => v.toFixed(1),
  },
  {
    id: "timeToGo",
    label: "Time to go",
    short: "to go",
    group: "Ride",
    value: (r) => (r.remainingMetric === "time" && r.remaining != null ? r.remaining : undefined),
    show: (v) => formatElapsed(v * 1000),
  },
];
/** Then everything else Sauce knows about the rider - the Ride ones stand in for its own speed, distance and grade. */
export const STAT_FIELDS = [...RIDE_FIELDS, ...RIDER_FIELDS.filter((f) => !["speed", "distance", "grade"].includes(f.id))];
export const STAT_GROUPS: FieldGroup[] = ["Ride", ...FIELD_GROUPS];
