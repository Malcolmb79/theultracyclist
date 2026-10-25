import type { SauceAthleteData, SauceGroup } from "./sauceFeed";

// Zwift puts every category of an event on the same road, so the riders
// around can include another race altogether - the A riders coming
// through, the C riders being caught. These pick out the rider's own race:
// riders in the same event subgroup. The watched rider always counts, and
// so does anyone whose category Sauce doesn't know.

export function inRace(a: SauceAthleteData, subgroup: number | undefined): boolean {
  if (!subgroup || a.watching) return true;
  const theirs = a.state?.eventSubgroupId;
  return !theirs || theirs === subgroup;
}

/**
 * The groups as the rider's race sees them: other categories left out of
 * each group, its numbers worked out again from who's left, and groups of
 * only other categories gone. Outside an event, the groups as they are.
 */
export function sameRaceGroups(groups: SauceGroup[], subgroup: number | undefined): SauceGroup[] {
  if (!subgroup) return groups;
  const avg = (xs: (number | null | undefined)[]) => {
    const known = xs.filter((x): x is number => x != null);
    return known.length ? known.reduce((a, b) => a + b, 0) / known.length : undefined;
  };
  return groups.flatMap((g) => {
    const athletes = (g.athletes ?? []).filter((a) => inRace(a, subgroup));
    if (!g.watching && !athletes.length) return [];
    if (athletes.length === (g.athletes?.length ?? 0)) return [g];
    return [
      {
        ...g,
        athletes,
        power: avg(athletes.map((a) => a.state?.power)) ?? g.power,
        speed: avg(athletes.map((a) => a.state?.speed)) ?? g.speed,
        weight: avg(athletes.map((a) => a.athlete?.weight)) ?? g.weight,
      },
    ];
  });
}
