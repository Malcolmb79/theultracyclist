import { irelandDateStr, irelandTodayDateStr } from "./irelandDate";
import { formatDate } from "./formatDate";

// "Today" / "Yesterday" / "N days ago" instead of a bare date - much easier
// to register at a glance than "25 July 2026" when the point is whether a
// widget's data is actually current. Apple Health metrics sync via a
// push-based Shortcut (only updates when the phone/Health app actually
// pushes new data, not on a fixed schedule the way Whoop's once-daily
// recovery does), so it's normal for these to sit a day or more behind
// until something new syncs - this makes that age obvious rather than
// letting a plain date quietly read as "current" at a glance.
export function relativeDayLabel(dateStr: string): string {
  const today = irelandTodayDateStr();
  const target = irelandDateStr(new Date(dateStr));
  if (target === today) return "Today";

  const diffDays = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${target}T00:00:00Z`)) / 86400000);
  if (diffDays === 1) return "Yesterday";
  if (diffDays > 1) return `${diffDays} days ago`;
  return formatDate(dateStr); // a future-dated point shouldn't normally happen - fall back to a plain date rather than a nonsensical negative "ago".
}
