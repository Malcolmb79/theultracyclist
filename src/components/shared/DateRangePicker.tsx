import {
  DATE_RANGE_PRESETS,
  PAGE_RANGE_PRESETS,
  isCustomRange,
  type DateRangeId,
  type WidgetDateRange,
} from "../../utils/dateRange";
import styles from "./DateRangePicker.module.css";

/**
 * The range picker, used both on a widget and in Settings.
 *
 * One component for both so the two lists can never drift apart - the only
 * difference is that Settings has nothing above it to inherit from, so
 * `allowInherit` drops that entry rather than a second list existing.
 *
 * The custom-date inputs appear only for the presets that need them; showing
 * two empty date fields beside "Last 28 days" would suggest they did something.
 */
export default function DateRangePicker({
  value,
  onChange,
  allowInherit = true,
  compact = false,
  label,
}: {
  value: WidgetDateRange;
  onChange: (next: WidgetDateRange) => void;
  allowInherit?: boolean;
  compact?: boolean;
  label?: string;
}) {
  const presets = allowInherit ? DATE_RANGE_PRESETS : PAGE_RANGE_PRESETS;
  const showCustom = isCustomRange(value.id);
  // "Custom dates" is the only preset that needs an end as well - the other
  // two derive their end from today.
  const showEnd = value.id === "custom";

  return (
    <div className={`${styles.wrap} ${compact ? styles.compact : ""}`}>
      {label && <span className={styles.label}>{label}</span>}
      <select
        className={styles.select}
        value={value.id}
        onChange={(e) => onChange({ ...value, id: e.target.value as DateRangeId })}
        aria-label={label ?? "Date range"}
      >
        {presets.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.label}
          </option>
        ))}
      </select>
      {showCustom && (
        <span className={styles.customDates}>
          <input
            type="date"
            className={styles.date}
            value={value.customStart ?? ""}
            onChange={(e) => onChange({ ...value, customStart: e.target.value || undefined })}
            aria-label="Range start"
          />
          {showEnd && (
            <input
              type="date"
              className={styles.date}
              value={value.customEnd ?? ""}
              onChange={(e) => onChange({ ...value, customEnd: e.target.value || undefined })}
              aria-label="Range end"
            />
          )}
        </span>
      )}
    </div>
  );
}
