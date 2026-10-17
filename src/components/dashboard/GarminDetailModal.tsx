import RingGauge from "./RingGauge";
import { BandRow, ComparisonRow, DetailModal, TextRow } from "./detailParts";
import { average } from "./detailFormat";
import styles from "./DetailModal.module.css";
import {
  GARMIN_BATTERY_COLOR,
  GARMIN_LOAD_COLOR,
  GARMIN_SLEEP_COLOR,
  hrvStatusLabel,
  readinessColor,
  readinessLevel,
  type GarminDay,
} from "../../utils/garmin";
import { relativeDayLabel } from "../../utils/relativeDate";

export type GarminDetailKind = "sleep" | "readiness" | "load" | "bodyBattery";

const KIND_LABEL: Record<GarminDetailKind, string> = {
  sleep: "Sleep",
  readiness: "Training Readiness",
  load: "Training Load",
  bodyBattery: "Body Battery",
};

// The field that decides whether a day counts as "scored" for each view.
const KIND_FIELD = {
  sleep: "sleepScore",
  readiness: "readiness",
  load: "acuteLoad",
  bodyBattery: "bodyBattery",
} as const;

// Averages compare against the previous fortnight, not all history.
const COMPARISON_DAYS = 14;

interface GarminDetailModalProps {
  kind: GarminDetailKind;
  history: GarminDay[]; // chronological, oldest first
  onClose: () => void;
}

export default function GarminDetailModal({ kind, history, onClose }: GarminDetailModalProps) {
  const scored = history.filter((d) => d[KIND_FIELD[kind]] != null);
  const day = scored.at(-1);
  const prior = scored.slice(0, -1).slice(-COMPARISON_DAYS);
  const avg = (pick: (d: GarminDay) => number | null) => average(prior.map(pick));

  let body;
  if (!day) {
    body = <p className={styles.empty}>No Garmin data yet.</p>;
  } else if (kind === "sleep") {
    const need = day.sleepNeedHours;
    body = (
      <>
        <RingGauge percent={day.sleepScore!} color={GARMIN_SLEEP_COLOR} centerValue={`${day.sleepScore}`} label="SLEEP SCORE" pixelSize={200} />
        <ul className={styles.rows}>
          {day.sleepHours != null && need != null && need > 0 && <BandRow label="Hours vs Needed" percent={(day.sleepHours / need) * 100} />}
          {day.sleepHours != null && <ComparisonRow label="Sleep" value={day.sleepHours * 60} avgValue={scaled(avg((d) => d.sleepHours), 60)} minutesFormat goodDirection="up" />}
          {day.deepHours != null && <ComparisonRow label="Deep" value={day.deepHours * 60} avgValue={scaled(avg((d) => d.deepHours), 60)} minutesFormat goodDirection="up" />}
          {day.remHours != null && <ComparisonRow label="REM" value={day.remHours * 60} avgValue={scaled(avg((d) => d.remHours), 60)} minutesFormat goodDirection="up" />}
          {day.lightHours != null && <ComparisonRow label="Light" value={day.lightHours * 60} avgValue={scaled(avg((d) => d.lightHours), 60)} minutesFormat goodDirection="neutral" />}
          {day.awakeHours != null && <ComparisonRow label="Awake" value={day.awakeHours * 60} avgValue={scaled(avg((d) => d.awakeHours), 60)} minutesFormat goodDirection="down" />}
          {day.awakenings != null && <ComparisonRow label="Times woken" value={day.awakenings} avgValue={avg((d) => d.awakenings)} goodDirection="down" />}
          {day.sleepStress != null && <ComparisonRow label="Sleep stress" value={day.sleepStress} avgValue={avg((d) => d.sleepStress)} goodDirection="down" />}
          {day.respiration != null && <ComparisonRow label="Respiration" value={day.respiration} avgValue={avg((d) => d.respiration)} unit=" brpm" goodDirection="neutral" />}
          {day.sleepBatteryGain != null && <ComparisonRow label="Body Battery recharged" value={day.sleepBatteryGain} avgValue={avg((d) => d.sleepBatteryGain)} goodDirection="up" />}
        </ul>
        <p className={styles.note}>{relativeDayLabel(day.date)}. Arrows compare with your previous two weeks.</p>
      </>
    );
  } else if (kind === "readiness") {
    const f = day.factors;
    const status = hrvStatusLabel(day.hrvStatus);
    body = (
      <>
        <RingGauge
          percent={day.readiness!}
          color={readinessColor(day.readiness!)}
          centerValue={`${day.readiness}`}
          label={readinessLevel(day.readiness!).toUpperCase()}
          pixelSize={200}
        />
        <ul className={styles.rows}>
          {f.sleep != null && <BandRow label="Sleep score" percent={f.sleep} />}
          {f.recovery != null && <BandRow label="Recovery time" percent={f.recovery} />}
          {f.hrv != null && <BandRow label="HRV status" percent={f.hrv} />}
          {f.load != null && <BandRow label="Training load balance" percent={f.load} />}
          {f.stress != null && <BandRow label="Stress history" percent={f.stress} />}
          {f.sleepHistory != null && <BandRow label="Sleep history" percent={f.sleepHistory} />}
          {day.hrv != null && <ComparisonRow label="Overnight HRV" value={day.hrv} avgValue={avg((d) => d.hrv)} unit=" ms" goodDirection="up" />}
          {status && <TextRow label="HRV status" value={day.hrvWeekly != null ? `${status} (7-day ${day.hrvWeekly} ms)` : status} />}
          {day.restingHr != null && <ComparisonRow label="Resting heart rate" value={day.restingHr} avgValue={avg((d) => d.restingHr)} unit=" bpm" goodDirection="down" />}
          {day.recoveryHours != null && <TextRow label="Recovery time left" value={`${Math.round(day.recoveryHours)} h`} />}
        </ul>
        <p className={styles.note}>Bars show how much each factor is helping today's score (100% = not holding it back).</p>
      </>
    );
  } else if (kind === "load") {
    const dailyAverage = day.acuteLoad != null ? day.acuteLoad / 7 : null;
    const load = day.trainingLoad ?? 0;
    body = (
      <>
        <RingGauge
          // A full ring is twice your recent daily average.
          percent={dailyAverage ? Math.min(100, (load / (dailyAverage * 2)) * 100) : 0}
          color={GARMIN_LOAD_COLOR}
          centerValue={`${Math.round(load)}`}
          label="TODAY'S LOAD"
          pixelSize={200}
        />
        <ul className={styles.rows}>
          <ComparisonRow label="Training load" value={Math.round(load)} avgValue={dailyAverage} goodDirection="neutral" />
          {day.acuteLoad != null && <ComparisonRow label="Acute load (7-day)" value={day.acuteLoad} avgValue={avg((d) => d.acuteLoad)} goodDirection="neutral" />}
          {day.activityMinutes != null && <ComparisonRow label="Activity time" value={day.activityMinutes} avgValue={avg((d) => d.activityMinutes)} minutesFormat goodDirection="neutral" />}
          {day.steps != null && <ComparisonRow label="Steps" value={day.steps} avgValue={avg((d) => d.steps)} goodDirection="neutral" />}
          {day.stress != null && <ComparisonRow label="Average stress" value={day.stress} avgValue={avg((d) => d.stress)} goodDirection="down" />}
        </ul>
        <p className={styles.note}>
          Garmin has no single daily strain score; this is the training load of the day's activities against your 7-day acute load.
        </p>
      </>
    );
  } else {
    body = (
      <>
        <RingGauge percent={day.bodyBattery!} color={GARMIN_BATTERY_COLOR} centerValue={`${day.bodyBattery}`} label="BODY BATTERY" pixelSize={200} />
        <ul className={styles.rows}>
          {day.bodyBatteryWake != null && <ComparisonRow label="At wake" value={day.bodyBatteryWake} avgValue={avg((d) => d.bodyBatteryWake)} goodDirection="up" />}
          {day.bodyBatteryHigh != null && day.bodyBatteryLow != null && <TextRow label="High / low" value={`${day.bodyBatteryHigh} / ${day.bodyBatteryLow}`} />}
          {day.charged != null && <ComparisonRow label="Charged" value={day.charged} avgValue={avg((d) => d.charged)} goodDirection="up" />}
          {day.drained != null && <ComparisonRow label="Drained" value={day.drained} avgValue={avg((d) => d.drained)} goodDirection="neutral" />}
          {day.stress != null && <ComparisonRow label="Average stress" value={day.stress} avgValue={avg((d) => d.stress)} goodDirection="down" />}
        </ul>
      </>
    );
  }

  return (
    <DetailModal title={KIND_LABEL[kind]} onClose={onClose}>
      {body}
    </DetailModal>
  );
}

function scaled(value: number | null, factor: number): number | null {
  return value == null ? null : value * factor;
}
