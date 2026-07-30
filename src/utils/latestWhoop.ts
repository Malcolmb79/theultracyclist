/**
 * The most recent *scored* value for each Whoop field, rather than whatever the
 * newest cycle happens to hold.
 *
 * A cycle exists as soon as it starts, but its scores arrive at different times:
 * strain climbs live all day, while recovery and sleep are scored after the
 * night and can lag by hours - Whoop's own API publishes them later than the
 * watch shows them. Taking the newest cycle wholesale therefore blanks recovery
 * and sleep for most of the morning, which is worse than useless: the athlete
 * knows those numbers exist because the watch is showing them.
 *
 * So each field falls back independently to the last day it was scored, and the
 * date it came from travels with it so nothing is presented as today's when it
 * isn't.
 */

export type WhoopDayLike = {
  date: string;
  recovery?: { score: number } | null;
  strain?: { score: number } | null;
  sleep?: { performancePercent: number } | null;
};

export type LatestWhoopField<T> = { value: T; date: string } | null;

export type LatestWhoop<TDay extends WhoopDayLike> = {
  /** The newest cycle, whatever it does or doesn't have scored yet. */
  day: TDay | undefined;
  recovery: LatestWhoopField<NonNullable<TDay["recovery"]>>;
  strain: LatestWhoopField<NonNullable<TDay["strain"]>>;
  sleep: LatestWhoopField<NonNullable<TDay["sleep"]>>;
};

/** `history` is chronological, oldest first - the same order the hooks use. */
export function latestWhoop<TDay extends WhoopDayLike>(history: TDay[]): LatestWhoop<TDay> {
  const newestScored = <K extends "recovery" | "strain" | "sleep">(key: K) => {
    for (let i = history.length - 1; i >= 0; i--) {
      const value = history[i][key];
      if (value) return { value: value as NonNullable<TDay[K]>, date: history[i].date };
    }
    return null;
  };

  return {
    day: history[history.length - 1],
    recovery: newestScored("recovery"),
    strain: newestScored("strain"),
    sleep: newestScored("sleep"),
  };
}
