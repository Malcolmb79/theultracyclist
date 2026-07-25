import { useState } from "react";
import type { CoachingSettings, TrainingPhase, WeeklyProgress } from "./types";
import { PHASE_GUIDANCE } from "./types";
import styles from "./TrainingPlanCard.module.css";

interface TrainingPlanCardProps {
  settings: CoachingSettings;
  onSaveSettings: (next: CoachingSettings) => Promise<void>;
  weeklyProgress: WeeklyProgress;
}

function ProgressBar({ actual, target, unit }: { actual: number; target: number | null; unit: string }) {
  const percent = target && target > 0 ? Math.min(100, (actual / target) * 100) : 0;
  return (
    <div className={styles.progressRow}>
      <div className={styles.progressTrack}>
        <div className={styles.progressFill} style={{ width: `${percent}%` }} />
      </div>
      <span className={styles.progressLabel}>
        {actual}
        {unit}
        {target != null ? ` / ${target}${unit}` : ""}
      </span>
    </div>
  );
}

export default function TrainingPlanCard({ settings, onSaveSettings, weeklyProgress }: TrainingPlanCardProps) {
  const [distanceInput, setDistanceInput] = useState(settings.weeklyDistanceKm?.toString() ?? "");
  const [hoursInput, setHoursInput] = useState(settings.weeklyHours?.toString() ?? "");
  const [saving, setSaving] = useState(false);

  const phase = settings.phase ?? "build";

  const handlePhaseChange = (nextPhase: TrainingPhase) => {
    onSaveSettings({ ...settings, phase: nextPhase });
  };

  const handleSaveTargets = async () => {
    setSaving(true);
    try {
      await onSaveSettings({
        ...settings,
        weeklyDistanceKm: distanceInput === "" ? undefined : Number(distanceInput),
        weeklyHours: hoursInput === "" ? undefined : Number(hoursInput),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.card}>
      <div className={styles.headerRow}>
        <span className={styles.eyebrow}>Training plan</span>
        <select className={styles.phaseSelect} value={phase} onChange={(e) => handlePhaseChange(e.target.value as TrainingPhase)}>
          <option value="build">Build</option>
          <option value="recovery">Recovery</option>
          <option value="taper">Taper</option>
        </select>
      </div>

      <p className={styles.guidance}>{PHASE_GUIDANCE[phase].description}</p>

      <div className={styles.week}>
        <span className={styles.subheading}>This week</span>
        <ProgressBar actual={weeklyProgress.distanceKm} target={weeklyProgress.distanceTargetKm} unit="km" />
        <ProgressBar actual={weeklyProgress.hours} target={weeklyProgress.hoursTargetHours} unit="h" />
        <span className={styles.rideCount}>{weeklyProgress.rideCount} ride{weeklyProgress.rideCount === 1 ? "" : "s"} so far</span>
      </div>

      <div className={styles.targets}>
        <span className={styles.subheading}>Weekly targets</span>
        <div className={styles.targetInputs}>
          <label className={styles.targetLabel}>
            Distance
            <input
              type="number"
              className={styles.targetInput}
              value={distanceInput}
              onChange={(e) => setDistanceInput(e.target.value)}
              placeholder="km"
            />
          </label>
          <label className={styles.targetLabel}>
            Hours
            <input
              type="number"
              className={styles.targetInput}
              value={hoursInput}
              onChange={(e) => setHoursInput(e.target.value)}
              placeholder="h"
            />
          </label>
          <button type="button" className={styles.saveButton} onClick={handleSaveTargets} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
