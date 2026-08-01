import DashboardWidget from "../dashboard/DashboardWidget";
import type { MetricDef, WhoopDay } from "../dashboard/useDashboardData";
import type { PerformancePoint } from "../../utils/performanceSeries";
import type { Widget } from "../dashboard/types";
import styles from "./ChatWidgetMessage.module.css";

/**
 * Expands the `[widget:<metric>:<view>]` markers the coach places in a reply
 * (see the show_widget tool in api/coaching-chat.ts) into the actual dashboard
 * widget, rendered between the surrounding prose.
 *
 * A marker rather than a second field on the response because
 * generateCoachReply returns one string and WhatsApp shares it - there the
 * marker is stripped instead (whatsapp-webhook.ts). If a marker ever names a
 * metric that doesn't exist, the text is left exactly as the coach wrote it
 * rather than silently vanishing, so a wrong id is visible instead of looking
 * like the widget failed to load.
 */

const WIDGET_MARKER = /\[widget:([^:\]]+)(?::([^\]]*))?\]/g;

// Enough room for the composite cards (macro donut, calendar) without letting
// one reply take over the conversation.
const INLINE_WIDGET_HEIGHT = 300;

const VIEW_TYPES = new Set(["stat", "chart", "timeline", "ring"]);

export type ChatWidgetData = {
  metricById: Map<string, MetricDef>;
  whoopHistory: WhoopDay[];
  performanceSeries: PerformancePoint[];
  goals?: Record<string, unknown>;
  caloriesBurnSettings?: { wakeTime?: string; targetKcal?: number; targetTime?: string };
};

type Segment = { type: "text"; text: string } | { type: "widget"; metric: string; view: Widget["viewType"] };

export function splitWidgetMarkers(content: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;

  for (const match of content.matchAll(WIDGET_MARKER)) {
    const [raw, metric, view] = match;
    const start = match.index ?? 0;
    if (start > cursor) segments.push({ type: "text", text: content.slice(cursor, start) });
    segments.push({
      type: "widget",
      metric: metric.trim(),
      view: (VIEW_TYPES.has(view ?? "") ? view : "chart") as Widget["viewType"],
    });
    cursor = start + raw.length;
  }

  if (cursor < content.length) segments.push({ type: "text", text: content.slice(cursor) });
  return segments;
}

export default function ChatWidgetMessage({ content, data }: { content: string; data?: ChatWidgetData }) {
  const segments = splitWidgetMarkers(content);

  // Nothing to expand, or no data to expand it with - render as written.
  if (!data || segments.every((s) => s.type === "text")) {
    return <p className={styles.text}>{content}</p>;
  }

  return (
    <div className={styles.wrap}>
      {segments.map((segment, i) => {
        if (segment.type === "text") {
          const text = segment.text.trim();
          return text ? (
            <p key={i} className={styles.text}>
              {text}
            </p>
          ) : null;
        }

        const metric = data.metricById.get(segment.metric);
        // Composite widgets (macro split, calories balance, health calendar,
        // performance chart, ...) are catalog entries too, so a hit here covers
        // them; a miss means the coach named something that isn't in the
        // catalog on this account.
        if (!metric) {
          return (
            <p key={i} className={styles.missing}>
              (couldn't show <code>{segment.metric}</code> - no such widget)
            </p>
          );
        }

        const widget: Widget = {
          id: `chat-${segment.metric}-${i}`,
          source: metric.source,
          metric: metric.id,
          label: metric.label,
          viewType: segment.view,
          width: 0,
          height: INLINE_WIDGET_HEIGHT,
        };

        return (
          <div key={i} className={styles.widgetSlot}>
            <DashboardWidget
              inline
              widget={widget}
              metricById={data.metricById}
              whoopHistory={data.whoopHistory}
              performanceSeries={data.performanceSeries}
              goals={data.goals}
              caloriesBurnSettings={data.caloriesBurnSettings}
              // Inline widgets are a view, not an editable canvas item - every
              // mutation is a no-op rather than silently writing to the saved
              // dashboard layout from inside a chat message.
              onViewTypeChange={() => {}}
              onColorChange={() => {}}
              onLabelChange={() => {}}
              onMove={() => {}}
              onResize={() => {}}
              onResizingChange={() => {}}
              onRemove={() => {}}
              onDateRangeChange={() => {}}
              page="dashboard"
            />
          </div>
        );
      })}
    </div>
  );
}
