import type { DatedGoal } from "./types";
import GoalTrajectory, { type TrajectoryPoint } from "./GoalTrajectory";
import { goalInsights } from "./goalInsights";
import styles from "./GoalProgress.module.css";

/**
 * A goal with a deadline: where it stands, where it needs to get to, and
 * whether the current rate gets there in time.
 *
 * The per-day goal widgets answer "did I hit it today". This answers "will I
 * get there by then", which is the question a target date creates and which
 * a daily hit-or-miss cannot express — a weight 2kg off target is a different
 * situation in March than it is the week before the deadline.
 */

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export default function GoalProgress({
  goal,
  todayIso,
  series = [],
}: {
  goal: DatedGoal;
  todayIso: string;
  /** Readings over time, where the metric has a history to plot. */
  series?: TrajectoryPoint[];
}) {
  const { current, target, start, targetDate, unit, direction } = goal;

  if (current == null || target == null) {
    return (
      <p className={styles.empty}>
        {target == null ? "No target set — add one in Settings." : "No reading yet to compare against the target."}
      </p>
    );
  }

  const gap = target - current;
  const reached = direction === "down" ? current <= target : current >= target;

  // Progress is measured from where it started, not from zero: a weight goal
  // from 82 to 78 is 50% done at 80, and meaningless as a share of 78.
  const span = start != null ? target - start : null;
  const done = span != null && span !== 0 ? Math.max(0, Math.min(1, (current - start!) / span)) : reached ? 1 : 0;

  const daysLeft = targetDate ? daysBetween(todayIso, targetDate) : null;

  // Required pace against actual pace. Only meaningful once there is a
  // deadline and a starting point to have moved from.
  const requiredPerWeek = daysLeft != null && daysLeft > 0 ? (gap / daysLeft) * 7 : null;

  const insights = goalInsights(series, target, unit, direction, todayIso);
  const charted = series.length >= 2 && !!targetDate;

  return (
    <div className={styles.wrap}>
      {/* Side by side where there is room: the chart answers "am I on track"
          and the column beside it answers the questions that follow — how fast
          this is moving and where that rate lands. Stacks on a narrow card. */}
      <div className={charted ? styles.split : undefined}>
        <div className={styles.chartCol}>
          {charted ? (
            <GoalTrajectory points={series} target={target} targetDate={targetDate} todayIso={todayIso} unit={unit} direction={direction} />
          ) : (
            <div className={styles.track}>
              <div className={`${styles.fill} ${reached ? styles.fillDone : ""}`} style={{ width: `${done * 100}%` }} />
            </div>
          )}
        </div>

        {insights.length > 0 && (
          <dl className={styles.insights}>
            {insights.map((insight) => (
              <div key={insight.label} className={styles.insightRow}>
                <dt className={styles.insightLabel}>{insight.label}</dt>
                <dd
                  className={`${styles.insightValue} ${insight.tone === "good" ? styles.good : ""} ${
                    insight.tone === "bad" ? styles.late : ""
                  }`}
                >
                  {insight.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div className={styles.figures}>
        <div>
          <p className={styles.label}>Now</p>
          <p className={styles.value}>
            {Math.round(current * 10) / 10}
            <span className={styles.unit}>{unit}</span>
          </p>
        </div>
        <div>
          <p className={styles.label}>Target</p>
          <p className={styles.value}>
            {Math.round(target * 10) / 10}
            <span className={styles.unit}>{unit}</span>
          </p>
        </div>
      </div>

      <p className={styles.status}>
        {reached ? (
          <span className={styles.good}>Target reached</span>
        ) : (
          <>
            {Math.abs(Math.round(gap * 10) / 10)}
            {unit} to go
            {daysLeft != null && daysLeft > 0 && (
              <>
                {" · "}
                {daysLeft} day{daysLeft === 1 ? "" : "s"} left
                {requiredPerWeek != null && (
                  <>
                    {" · "}
                    {Math.abs(Math.round(requiredPerWeek * 100) / 100)}
                    {unit}/week needed
                  </>
                )}
              </>
            )}
            {/* A deadline in the past is not a failure to hide — it is the
                most useful thing the widget can say. */}
            {daysLeft != null && daysLeft <= 0 && <span className={styles.late}> · target date passed</span>}
          </>
        )}
      </p>

      {targetDate && <p className={styles.deadline}>by {formatDate(targetDate)}</p>}
      {!targetDate && <p className={styles.deadline}>No date set — add one in Settings to track pace</p>}
    </div>
  );
}
