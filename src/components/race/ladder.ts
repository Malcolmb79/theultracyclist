// Club Ladder races: two club teams against each other, usually five a
// side, scored on points by finishing place. The scoring is shared by the
// race log (for the commentator and coach) and the ladder score overlay,
// so they always agree on the score.

/** "Club Ladder // DIRTy Strangers v ART Hadrons" - the two teams, by name. */
export function ladderTeams(eventName: string | undefined): [string, string] | undefined {
  const m = eventName?.match(/ladder\s*\/\/\s*(.+?)\s+v(?:s|\.)?\s+(.+?)\s*$/i);
  return m ? [m[1].trim(), m[2].trim()] : undefined;
}

/** Points for a place: 10 for 1st down to 1 for 10th - Club Ladder's usual count. */
export const LADDER_SCORING = "10 points for 1st down to 1 for 10th";
export function ladderPoints(pos: number | undefined): number {
  return pos != null && pos > 0 ? Math.max(0, 11 - pos) : 0;
}

export interface LadderEntry {
  name: string;
  team?: string;
  pos?: number;
  gap?: number;
  state?: string;
}

export interface LadderTeam {
  name: string;
  points: number;
  riders: (LadderEntry & { points: number })[];
}

/**
 * A Club Ladder race as a team score: the rider's team against the other,
 * each rider's place and the points it is worth if the race finished now.
 */
export interface TeamStanding {
  ours: LadderTeam;
  theirs: LadderTeam;
  leading: "ours" | "theirs" | "level";
  margin: number;
  /** How points are counted, so the commentator can say it. */
  scoring: string;
}

/**
 * The score from everyone in the race: the rider's team is those wearing
 * their team tag, the rest are the opposition, and the event name gives
 * the two teams' names. Undefined without a tag, or without both teams.
 */
export function scoreTeams(entries: LadderEntry[], riderTag: string | undefined, eventName: string | undefined): TeamStanding | undefined {
  const tag = riderTag?.trim().toLowerCase();
  if (!tag) return undefined;
  const mineSide = (e: LadderEntry) => e.team?.trim().toLowerCase() === tag;
  const build = (ours: boolean, name: string): LadderTeam => {
    const riders = entries
      .filter((e) => mineSide(e) === ours)
      .map((e) => ({ ...e, points: ladderPoints(e.pos) }))
      .sort((x, y) => (x.pos ?? 999) - (y.pos ?? 999));
    return { name, points: riders.reduce((sum, r) => sum + r.points, 0), riders };
  };
  // Which of the two names in the event title is the rider's: the one their tag starts.
  const names = ladderTeams(eventName);
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const mine = names?.find((n) => key(n).startsWith(key(tag).slice(0, 3)));
  const ours = build(true, mine ?? riderTag ?? "Your team");
  const theirs = build(false, names?.find((n) => n !== mine) ?? "The opposition");
  if (!ours.riders.length || !theirs.riders.length) return undefined;
  const leading = ours.points === theirs.points ? "level" : ours.points > theirs.points ? "ours" : "theirs";
  return { ours, theirs, leading, margin: Math.abs(ours.points - theirs.points), scoring: LADDER_SCORING };
}
