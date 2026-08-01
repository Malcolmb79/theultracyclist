import { useEffect, useState } from "react";
import { useUnits } from "../../context/UnitsContext";
import { convertValueUnit } from "../../utils/units";
import { irelandTodayDateStr } from "../../utils/irelandDate";
import styles from "./AllActivityCard.module.css";

/**
 * Everything the athlete did, newest first, grouped by day.
 *
 * Deliberately not filtered to bike rides the way the rest of the dashboard
 * is: the point of this widget is the sessions the cycling-only view drops -
 * runs, walks, strength, and anything Whoop caught that never reached Strava.
 *
 * TSS is shown only where it exists, which is rides with power. A run has no
 * TSS here, and inventing one would put a number on this card that the
 * fitness chart would refuse to agree with.
 */

export type MergedActivity = {
  id: string;
  source: "strava" | "whoop";
  sport: string;
  name: string;
  date: string;
  startDate: string;
  durationMinutes: number | null;
  distanceKm: number | null;
  elevationGainM: number | null;
  avgWatts: number | null;
  avgHeartrate: number | null;
  tss: number | null;
  alsoOnWhoop?: boolean;
};

// Sports are named differently by each source ("VirtualRide", "Weight
// Training"), so matching is loose and falls back to a neutral mark rather
// than guessing wrong.
const SPORT_ICONS: { pattern: RegExp; icon: string }[] = [
  { pattern: /ride|cycl|bike|zwift/i, icon: "🚲" },
  { pattern: /run|jog/i, icon: "🏃" },
  { pattern: /walk|hike/i, icon: "🚶" },
  { pattern: /swim/i, icon: "🏊" },
  { pattern: /strength|weight|gym|lift/i, icon: "🏋" },
  { pattern: /yoga|stretch|mobility/i, icon: "🧘" },
  { pattern: /row/i, icon: "🚣" },
  { pattern: /pickle|tennis|padel|squash/i, icon: "🎾" },
  { pattern: /ski|snowboard/i, icon: "⛷" },
  // Whoop logs recovery modalities as workouts. They are kept deliberately -
  // they are part of what the athlete did - so they get their own marks rather
  // than falling through to the generic bullet, which made them look like
  // unrecognised noise in a list they belong in.
  { pattern: /meditat|breath|mindful/i, icon: "🧠" },
  { pattern: /compression|massage|sauna|ice bath|cold|recovery/i, icon: "💆" },
  { pattern: /dog|pet/i, icon: "🐕" },
];

function iconFor(sport: string): string {
  return SPORT_ICONS.find((entry) => entry.pattern.test(sport))?.icon ?? "•";
}

function formatDuration(minutes: number | null): string | null {
  if (minutes == null || minutes <= 0) return null;
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h${String(rest).padStart(2, "0")}`;
}

function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function dayHeading(date: string, today: string): string {
  if (date === today) return "Today";
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (date === yesterday.toISOString().slice(0, 10)) return "Yesterday";
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export default function AllActivityCard({ range }: { range?: { start: string; end: string } }) {
  const { system } = useUnits();
  const [state, setState] = useState<{ status: "loading" } | { status: "ready"; activities: MergedActivity[] } | { status: "error" }>(
    { status: "loading" },
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/api/activities?count=120")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { activities?: MergedActivity[] }) => {
        if (!cancelled) setState({ status: "ready", activities: body.activities ?? [] });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") return <p className={styles.empty}>Loading activity…</p>;
  if (state.status === "error") return <p className={styles.empty}>Couldn&apos;t load activity right now.</p>;

  const activities = range
    ? state.activities.filter((a) => a.date >= range.start && a.date <= range.end)
    : state.activities;

  if (activities.length === 0) {
    return <p className={styles.empty}>{range ? "No activity in this date range." : "No activity recorded yet."}</p>;
  }

  const today = irelandTodayDateStr();
  const byDay = new Map<string, MergedActivity[]>();
  for (const activity of activities) {
    const list = byDay.get(activity.date) ?? [];
    list.push(activity);
    byDay.set(activity.date, list);
  }

  const distance = (km: number) => {
    const shown = convertValueUnit(km, "km", system);
    return `${Math.round(shown.value * 10) / 10}${shown.unit}`;
  };

  return (
    <>
      {/* The window this list is showing, and how much is in it.
          Without it a range change looks like nothing happened: the list is
          newest-first, so narrowing from 90 days to 7 leaves the visible top
          rows identical and only shortens the scroll. */}
      {range && (
        <p className={styles.summary}>
          {activities.length} {activities.length === 1 ? "activity" : "activities"} · {shortDate(range.start)} –{" "}
          {shortDate(range.end)}
        </p>
      )}
      <ul className={styles.days}>
      {[...byDay.entries()].map(([date, list]) => (
        <li key={date} className={styles.day}>
          <p className={styles.dayHeading}>{dayHeading(date, today)}</p>
          <ul className={styles.list}>
            {list.map((activity) => {
              // Only the facts that exist for this sport - a gym session has
              // no distance, a run has no TSS here, and an em dash for each
              // absent field would be noise on a card that is mostly a list.
              const facts = [
                formatDuration(activity.durationMinutes),
                activity.distanceKm != null ? distance(activity.distanceKm) : null,
                activity.tss != null ? `${Math.round(activity.tss)} TSS` : null,
                activity.avgHeartrate != null ? `${Math.round(activity.avgHeartrate)}bpm` : null,
              ].filter((v): v is string => v != null);

              return (
                <li key={activity.id} className={styles.row}>
                  <span className={styles.icon} aria-hidden="true">
                    {iconFor(activity.sport)}
                  </span>
                  <span className={styles.name} title={activity.name}>
                    {activity.name}
                  </span>
                  <span className={styles.facts}>{facts.join(" · ")}</span>
                  {activity.source === "whoop" && (
                    <span className={styles.badge} title="Whoop recorded this; it never reached Strava">
                      Whoop
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </li>
      ))}
      </ul>
    </>
  );
}
