import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Widget images for WhatsApp.
 *
 * Twilio sends media by URL and fetches it itself, unauthenticated, so these
 * images cannot sit behind a session. Instead each URL carries a signed,
 * short-lived token naming exactly one widget - unguessable, and useless
 * shortly after it was sent. Without that this endpoint would publish body
 * weight and nutrition to anyone who tried a URL.
 *
 * The SVG here deliberately duplicates a little of what the React widgets draw.
 * That is the cost of putting a picture in a text-only transport, and it means
 * these can drift from the dashboard versions - so it is kept to the few simple
 * shapes worth having, and anything else falls back to the coach describing the
 * numbers.
 */

const TOKEN_TTL_MS = 30 * 60 * 1000;

export type WidgetImageSpec = { metric: string; view: string };

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function signWidgetToken(spec: WidgetImageSpec, secret: string): string {
  const payload = Buffer.from(
    JSON.stringify({ m: spec.metric, v: spec.view, exp: Date.now() + TOKEN_TTL_MS }),
  ).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyWidgetToken(token: string, secret: string): WidgetImageSpec | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;

  const expected = sign(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      m?: string;
      v?: string;
      exp?: number;
    };
    if (!data.m || typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return { metric: data.m, view: data.v ?? "chart" };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// SVG building blocks. Dark surface only: a WhatsApp thread has no light mode
// to respond to, and these are pictures rather than pages.
// ---------------------------------------------------------------------------

const W = 720;
const H = 420;
const BG = "#14181d";
const TEXT = "#f5f6f7";
const MUTED = "#9aa4ae";
// The bundled family, not a system stack: the renderer runs with system fonts
// disabled (there are none on the serverless runtime), so a family it hasn't
// been handed draws nothing at all - which is how the first WhatsApp image
// arrived as a donut with every label missing.
const FONT = "Inter";

// Matches src/utils/macros.ts - same fixed order, same categorical colours.
const MACRO_COLORS = { carbs: "#5b8def", fat: "#c9781f", protein: "#12a37c" };

// Matches src/utils/bmi.ts's BMI_BANDS.
const BMI_BANDS = [
  { label: "Underweight", max: 18.5, color: "#f4d35e" },
  { label: "Healthy", max: 25, color: "#2ee6a6" },
  { label: "Overweight", max: 30, color: "#ffb020" },
  { label: "Obese", max: 40, color: "#ff4d2e" },
  { label: "Extremely obese", max: 45, color: "#8b1e1e" },
];

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function frame(title: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" rx="20" fill="${BG}"/>
  <text x="40" y="62" fill="${TEXT}" font-family="${FONT}" font-size="28" font-weight="600">${esc(title)}</text>
  ${body}
</svg>`;
}

export function noDataImage(title: string, message: string): string {
  return frame(title, `<text x="40" y="140" fill="${MUTED}" font-family="${FONT}" font-size="20">${esc(message)}</text>`);
}

export function bmiSvg(bmi: number, weight: { value: number; unit: string } | null, dateLabel: string): string {
  const min = 15;
  const max = 45;
  const barX = 40;
  const barW = W - 80;
  const barY = 250;
  const clamped = Math.max(min, Math.min(max, bmi));
  const markerX = barX + ((clamped - min) / (max - min)) * barW;
  const band = BMI_BANDS.find((b) => bmi < b.max) ?? BMI_BANDS[BMI_BANDS.length - 1];

  let segStart = min;
  const segments = BMI_BANDS.map((b) => {
    const end = Math.min(b.max, max);
    const x = barX + ((segStart - min) / (max - min)) * barW;
    const w = ((end - segStart) / (max - min)) * barW;
    segStart = end;
    return `<rect x="${x.toFixed(1)}" y="${barY}" width="${Math.max(0, w - 2).toFixed(1)}" height="26" rx="8" fill="${b.color}"/>`;
  }).join("");

  const ticks = [18.5, 25, 30, 40]
    .map((t) => {
      const x = barX + ((t - min) / (max - min)) * barW;
      return `<text x="${x.toFixed(1)}" y="${barY + 56}" fill="${MUTED}" font-family="${FONT}" font-size="16" text-anchor="middle">${t}</text>`;
    })
    .join("");

  return frame(
    "BMI",
    `<text x="40" y="170" fill="${band.color}" font-family="${FONT}" font-size="72" font-weight="700">${bmi.toFixed(1)}</text>
     <text x="${40 + String(bmi.toFixed(1)).length * 42}" y="170" fill="${band.color}" font-family="${FONT}" font-size="24" font-weight="700" letter-spacing="1">${esc(band.label.toUpperCase())}</text>
     ${segments}
     <polygon points="${markerX.toFixed(1)},${barY - 6} ${(markerX - 9).toFixed(1)},${barY - 22} ${(markerX + 9).toFixed(1)},${barY - 22}" fill="${TEXT}"/>
     ${ticks}
     <text x="40" y="${barY + 110}" fill="${MUTED}" font-family="${FONT}" font-size="18">${esc(
       weight != null ? `${dateLabel} · ${Math.round(weight.value * 10) / 10} ${weight.unit}` : dateLabel,
     )}</text>`,
  );
}

const KCAL_PER_G = { carbs: 4, fat: 9, protein: 4 };

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function donutArc(cx: number, cy: number, ro: number, ri: number, from: number, to: number): string {
  const large = to - from > 180 ? 1 : 0;
  const [x1, y1] = polar(cx, cy, ro, from);
  const [x2, y2] = polar(cx, cy, ro, to);
  const [x3, y3] = polar(cx, cy, ri, to);
  const [x4, y4] = polar(cx, cy, ri, from);
  return `M${x1.toFixed(1)},${y1.toFixed(1)} A${ro},${ro} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)} L${x3.toFixed(1)},${y3.toFixed(1)} A${ri},${ri} 0 ${large} 0 ${x4.toFixed(1)},${y4.toFixed(1)} Z`;
}

export function macroSplitSvg(
  grams: { carbs: number | null; fat: number | null; protein: number | null },
  dateLabel: string,
): string {
  const order = ["carbs", "fat", "protein"] as const;
  const kcals = order.map((k) => (grams[k] ?? 0) * KCAL_PER_G[k]);
  const total = kcals.reduce((a, b) => a + b, 0);
  if (total <= 0) return noDataImage("Macro split", "Nothing logged yet for that day.");

  const cx = 200;
  const cy = 250;
  const ro = 120;
  const ri = 78;
  let cursor = 0;
  const arcs: string[] = [];
  const labels: string[] = [];

  order.forEach((key, i) => {
    const pct = (kcals[i] / total) * 100;
    if (pct <= 0) return;
    const sweep = (pct / 100) * 360;
    const gap = sweep >= 359.9 ? 0 : 1.5;
    arcs.push(
      `<path d="${donutArc(cx, cy, ro, ri, cursor + gap, cursor + sweep - gap)}" fill="${MACRO_COLORS[key]}"/>`,
    );
    if (pct >= 8) {
      const [lx, ly] = polar(cx, cy, (ro + ri) / 2, cursor + sweep / 2);
      labels.push(
        `<text x="${lx.toFixed(1)}" y="${(ly + 6).toFixed(1)}" fill="#fff" font-family="${FONT}" font-size="20" font-weight="700" text-anchor="middle" stroke="rgba(0,0,0,.45)" stroke-width="3" paint-order="stroke fill">${Math.round(pct)}%</text>`,
      );
    }
    cursor += sweep;
  });

  const rows = order
    .map((key, i) => {
      const y = 170 + i * 52;
      const pct = Math.round((kcals[i] / total) * 100);
      const g = grams[key];
      return `<rect x="400" y="${y - 14}" width="16" height="16" rx="4" fill="${MACRO_COLORS[key]}"/>
        <text x="428" y="${y}" fill="${TEXT}" font-family="${FONT}" font-size="21">${esc(key === "carbs" ? "Carbohydrates" : key === "fat" ? "Fat" : "Protein")}</text>
        <text x="${W - 40}" y="${y}" fill="${MUTED}" font-family="${FONT}" font-size="21" text-anchor="end">${g != null ? `${Math.round(g)}g · ` : ""}${pct}%</text>`;
    })
    .join("");

  return frame(
    "Macro split",
    `${arcs.join("")}${labels.join("")}
     <text x="${cx}" y="${cy - 2}" fill="${TEXT}" font-family="${FONT}" font-size="34" font-weight="700" text-anchor="middle">${Math.round(total).toLocaleString("en-GB")}</text>
     <text x="${cx}" y="${cy + 26}" fill="${MUTED}" font-family="${FONT}" font-size="15" text-anchor="middle" letter-spacing="1">KCAL</text>
     ${rows}
     <text x="400" y="${170 + 3 * 52}" fill="${MUTED}" font-family="${FONT}" font-size="17">${esc(dateLabel)}</text>`,
  );
}

export function caloriesBalanceSvg(consumed: number | null, burned: number | null, dateLabel: string): string {
  if (consumed == null && burned == null) return noDataImage("Consumed vs burned", "No energy data for that day.");
  const max = Math.max(consumed ?? 0, burned ?? 0) || 1;
  const barX = 40;
  const barW = W - 80;
  const bar = (label: string, value: number | null, color: string, y: number) =>
    `<text x="${barX}" y="${y}" fill="${MUTED}" font-family="${FONT}" font-size="19">${esc(label)}</text>
     <text x="${W - 40}" y="${y}" fill="${color}" font-family="${FONT}" font-size="24" font-weight="700" text-anchor="end">${value != null ? `${Math.round(value).toLocaleString("en-GB")} kcal` : "—"}</text>
     <rect x="${barX}" y="${y + 14}" width="${barW}" height="22" rx="11" fill="rgba(255,255,255,.08)"/>
     <rect x="${barX}" y="${y + 14}" width="${(((value ?? 0) / max) * barW).toFixed(1)}" height="22" rx="11" fill="${color}"/>`;

  const net = consumed != null && burned != null ? Math.round(consumed - burned) : null;

  return frame(
    "Consumed vs burned",
    `${bar("Consumed", consumed, "#ffb020", 130)}
     ${bar("Burned", burned, "#4B87F5", 240)}
     ${
       net != null
         ? `<text x="${barX}" y="360" fill="${MUTED}" font-family="${FONT}" font-size="19">Net</text>
            <text x="${W - 40}" y="360" fill="${TEXT}" font-family="${FONT}" font-size="24" font-weight="700" text-anchor="end">${net > 0 ? "+" : ""}${net.toLocaleString("en-GB")} kcal</text>`
         : ""
     }
     <text x="${barX}" y="396" fill="${MUTED}" font-family="${FONT}" font-size="17">${esc(dateLabel)}</text>`,
  );
}

/** Which metrics can be drawn as an image; anything else is described instead. */
/**
 * The composite cards, which have their own shapes. Plain metrics are not
 * listed because every one of them is drawable through the generic stat /
 * chart / timeline / ring renderers - see resolveMetric.
 */
export const COMPOSITE_IMAGE_METRICS = new Set([
  "health.bmi",
  "health.macroSplit",
  "health.caloriesBalance",
  "goal.weight",
  "goal.ftp",
  "weather.current",
  "strava.performanceChart",
  "whoop.sleepRecoveryStrainRings",
]);

/**
 * Whether an image can be produced at all. Garmin LiveTrack is deliberately
 * absent: it is a live embedded map, and a still of it says nothing.
 */
export function isImageableMetric(metric: string): boolean {
  return (
    COMPOSITE_IMAGE_METRICS.has(metric) ||
    metric.startsWith("health.") ||
    metric.startsWith("whoop.") ||
    (metric.startsWith("strava.") && metric !== "strava.performanceChart") ||
    false
  );
}

// Kept for callers that only care about the bespoke set.
export const IMAGEABLE_METRICS = COMPOSITE_IMAGE_METRICS;

/**
 * A dated goal: where the athlete is, where they're going, and whether the
 * remaining time is realistic.
 *
 * `progress` is passed in rather than derived here because the two goals
 * measure it differently - weight has a real starting reading to move away
 * from, while FTP is a tested figure with no history behind it, so its bar
 * reads as a fraction of the target instead. See widget-image.ts.
 */
export function goalProgressSvg(goal: {
  title: string;
  current: number;
  target: number;
  unit: string;
  /** 0-1. */
  progress: number;
  /** Optional second reading of each figure, e.g. W/kg beside watts. */
  currentSecondary?: string;
  targetSecondary?: string;
  deadline?: string;
  daysLeft?: number | null;
  perWeekNeeded?: number | null;
  reached: boolean;
}): string {
  const barX = 40;
  const barW = W - 80;
  const barY = 150;
  const filled = Math.max(0, Math.min(1, goal.progress)) * barW;
  // Amber while there's still a gap, green once it's closed - the same
  // met/unmet colouring the dashboard's goal cards use.
  const fill = goal.reached ? "#2ee6a6" : "#ffb020";

  const gap = Math.abs(Math.round((goal.target - goal.current) * 10) / 10);
  const statusParts: string[] = [];
  if (goal.reached) {
    statusParts.push("Target reached");
  } else {
    statusParts.push(`${gap}${goal.unit} to go`);
    if (goal.daysLeft != null && goal.daysLeft > 0) {
      statusParts.push(`${goal.daysLeft} day${goal.daysLeft === 1 ? "" : "s"} left`);
      if (goal.perWeekNeeded != null) {
        statusParts.push(`${Math.abs(Math.round(goal.perWeekNeeded * 100) / 100)}${goal.unit}/week needed`);
      }
    } else if (goal.daysLeft != null) {
      statusParts.push("target date passed");
    }
  }

  return frame(
    goal.title,
    `<rect x="${barX}" y="${barY}" width="${barW}" height="22" rx="11" fill="rgba(255,255,255,.08)"/>
     <rect x="${barX}" y="${barY}" width="${filled.toFixed(1)}" height="22" rx="11" fill="${fill}"/>

     <text x="${barX}" y="${barY + 78}" fill="${MUTED}" font-family="${FONT}" font-size="16" letter-spacing="1">NOW</text>
     <text x="${barX}" y="${barY + 120}" fill="${TEXT}" font-family="${FONT}" font-size="44" font-weight="700">${Math.round(goal.current * 10) / 10}<tspan font-size="20" fill="${MUTED}"> ${esc(goal.unit)}</tspan></text>
     ${goal.currentSecondary ? `<text x="${barX}" y="${barY + 148}" fill="${MUTED}" font-family="${FONT}" font-size="17">${esc(goal.currentSecondary)}</text>` : ""}

     <text x="${W - 40}" y="${barY + 78}" fill="${MUTED}" font-family="${FONT}" font-size="16" letter-spacing="1" text-anchor="end">TARGET</text>
     <text x="${W - 40}" y="${barY + 120}" fill="${TEXT}" font-family="${FONT}" font-size="44" font-weight="700" text-anchor="end">${Math.round(goal.target * 10) / 10}<tspan font-size="20" fill="${MUTED}"> ${esc(goal.unit)}</tspan></text>
     ${goal.targetSecondary ? `<text x="${W - 40}" y="${barY + 148}" fill="${MUTED}" font-family="${FONT}" font-size="17" text-anchor="end">${esc(goal.targetSecondary)}</text>` : ""}

     <text x="${barX}" y="${H - 52}" fill="${goal.reached ? "#2ee6a6" : TEXT}" font-family="${FONT}" font-size="19">${esc(statusParts.join(" · "))}</text>
     ${goal.deadline ? `<text x="${barX}" y="${H - 24}" fill="${MUTED}" font-family="${FONT}" font-size="16">by ${esc(goal.deadline)}</text>` : ""}`,
  );
}

// ---------------------------------------------------------------------------
// Generic renderers, one per view type rather than one per metric.
//
// Every plain metric in the catalog is a stat, a chart, a timeline or a ring,
// so these four cover all of them - the alternative was a hand-written card per
// metric, which is dozens of near-copies and dozens of chances to drift from
// the dashboard.
// ---------------------------------------------------------------------------

function formatValue(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return rounded.toLocaleString("en-GB", { maximumFractionDigits: 1 });
}

export function statSvg(label: string, value: number | null, unit: string, dateLabel: string, color = "#2ee6a6"): string {
  return frame(
    label,
    value == null
      ? `<text x="40" y="160" fill="${MUTED}" font-family="${FONT}" font-size="20">No reading yet.</text>`
      : `<text x="40" y="215" fill="${color}" font-family="${FONT}" font-size="86" font-weight="700">${esc(formatValue(value))}<tspan font-size="30" fill="${MUTED}"> ${esc(unit)}</tspan></text>
         <text x="40" y="270" fill="${MUTED}" font-family="${FONT}" font-size="19">${esc(dateLabel)}</text>`,
  );
}

export function chartSvg(label: string, series: { date: string; value: number }[], unit: string, color = "#2ee6a6"): string {
  if (series.length < 2) return noDataImage(label, "Not enough history to chart yet.");

  const left = 40;
  const right = W - 40;
  const top = 110;
  const bottom = H - 70;
  const values = series.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series would divide by zero and, worse, draw a line pinned to the
  // top of the box as though it were a maximum.
  const span = max - min || Math.abs(max) || 1;
  const x = (i: number) => left + (i / (series.length - 1)) * (right - left);
  const y = (v: number) => bottom - ((v - min) / span) * (bottom - top);

  const line = series.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(series.length - 1).toFixed(1)},${bottom} L${x(0).toFixed(1)},${bottom} Z`;
  const last = series[series.length - 1];

  return frame(
    label,
    `<path d="${area}" fill="${color}" fill-opacity="0.15"/>
     <path d="${line}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
     <circle cx="${x(series.length - 1).toFixed(1)}" cy="${y(last.value).toFixed(1)}" r="5" fill="${color}"/>
     <text x="${right}" y="${(y(last.value) - 16).toFixed(1)}" fill="${TEXT}" font-family="${FONT}" font-size="22" font-weight="700" text-anchor="end">${esc(formatValue(last.value))}${esc(unit)}</text>
     <text x="${left}" y="${H - 34}" fill="${MUTED}" font-family="${FONT}" font-size="16">${esc(series[0].date)}</text>
     <text x="${right}" y="${H - 34}" fill="${MUTED}" font-family="${FONT}" font-size="16" text-anchor="end">${esc(last.date)}</text>
     <text x="${left}" y="${top - 20}" fill="${MUTED}" font-family="${FONT}" font-size="16">${esc(`${formatValue(min)}-${formatValue(max)}${unit}`)}</text>`,
  );
}

export function timelineSvg(label: string, series: { date: string; value: number }[], unit: string): string {
  if (series.length === 0) return noDataImage(label, "No readings yet.");
  const rows = series
    .slice(-8)
    .reverse()
    .map((p, i) => {
      const y = 120 + i * 36;
      return `<text x="40" y="${y}" fill="${MUTED}" font-family="${FONT}" font-size="18">${esc(p.date)}</text>
              <text x="${W - 40}" y="${y}" fill="${TEXT}" font-family="${FONT}" font-size="18" font-weight="600" text-anchor="end">${esc(formatValue(p.value))}${esc(unit)}</text>`;
    })
    .join("");
  return frame(label, rows);
}

export function ringSvg(label: string, value: number | null, unit: string, dateLabel: string, color = "#2ee6a6"): string {
  if (value == null) return noDataImage(label, "No reading yet.");
  const cx = W / 2;
  const cy = 250;
  const r = 110;
  const circumference = 2 * Math.PI * r;
  // Percent metrics fill the ring directly; anything else is shown against
  // 100 so the ring still means something rather than nothing.
  const fraction = Math.max(0, Math.min(1, (unit === "%" ? value : Math.min(value, 100)) / 100));

  return frame(
    label,
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="22"/>
     <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="22" stroke-linecap="round"
       stroke-dasharray="${(circumference * fraction).toFixed(1)} ${circumference.toFixed(1)}"
       transform="rotate(-90 ${cx} ${cy})"/>
     <text x="${cx}" y="${cy + 12}" fill="${TEXT}" font-family="${FONT}" font-size="52" font-weight="700" text-anchor="middle">${esc(formatValue(value))}<tspan font-size="22" fill="${MUTED}">${esc(unit)}</tspan></text>
     <text x="${cx}" y="${H - 34}" fill="${MUTED}" font-family="${FONT}" font-size="18" text-anchor="middle">${esc(dateLabel)}</text>`,
  );
}

// WMO weather codes, condensed to the groups worth naming on a phone-sized
// card - matching how WeatherCard labels them on the dashboard.
const WEATHER_LABELS: [number[], string][] = [
  [[0], "Clear"],
  [[1, 2], "Partly cloudy"],
  [[3], "Overcast"],
  [[45, 48], "Fog"],
  [[51, 53, 55, 56, 57], "Drizzle"],
  [[61, 63, 65, 66, 67, 80, 81, 82], "Rain"],
  [[71, 73, 75, 77, 85, 86], "Snow"],
  [[95, 96, 99], "Thunderstorm"],
];

export function weatherLabel(code: number): string {
  return WEATHER_LABELS.find(([codes]) => codes.includes(code))?.[1] ?? "—";
}

export function weatherSvg(weather: {
  place?: string;
  temperature: number;
  apparent: number;
  code: number;
  windSpeed: number;
  humidity: number;
  tempUnit: string;
  windUnit: string;
  days: { date: string; code: number; max: number; min: number }[];
}): string {
  const forecast = weather.days.slice(0, 5);
  const colWidth = (W - 80) / Math.max(1, forecast.length);
  const strip = forecast
    .map((day, i) => {
      const cx = 40 + colWidth * i + colWidth / 2;
      const name = new Date(`${day.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
      return `<text x="${cx.toFixed(0)}" y="${H - 92}" fill="${MUTED}" font-family="${FONT}" font-size="16" text-anchor="middle">${esc(name)}</text>
              <text x="${cx.toFixed(0)}" y="${H - 66}" fill="${TEXT}" font-family="${FONT}" font-size="17" text-anchor="middle">${Math.round(day.max)}°</text>
              <text x="${cx.toFixed(0)}" y="${H - 44}" fill="${MUTED}" font-family="${FONT}" font-size="15" text-anchor="middle">${Math.round(day.min)}°</text>
              <text x="${cx.toFixed(0)}" y="${H - 22}" fill="${MUTED}" font-family="${FONT}" font-size="13" text-anchor="middle">${esc(weatherLabel(day.code))}</text>`;
    })
    .join("");

  return frame(
    weather.place ? `Weather · ${weather.place}` : "Weather",
    `<text x="40" y="185" fill="${TEXT}" font-family="${FONT}" font-size="76" font-weight="700">${Math.round(weather.temperature)}<tspan font-size="30" fill="${MUTED}">${esc(weather.tempUnit)}</tspan></text>
     <text x="40" y="225" fill="${MUTED}" font-family="${FONT}" font-size="19">${esc(weatherLabel(weather.code))} · feels ${Math.round(weather.apparent)}${esc(weather.tempUnit)}</text>
     <text x="${W - 40}" y="185" fill="${MUTED}" font-family="${FONT}" font-size="19" text-anchor="end">Wind ${Math.round(weather.windSpeed)} ${esc(weather.windUnit)}</text>
     <text x="${W - 40}" y="215" fill="${MUTED}" font-family="${FONT}" font-size="19" text-anchor="end">Humidity ${Math.round(weather.humidity)}%</text>
     ${strip}`,
  );
}

export function performanceChartSvg(
  points: { date: string; ctl: number; atl: number; tsb: number }[],
  targets?: { ctl?: number | null; tsb?: number | null },
): string {
  if (points.length < 2) return noDataImage("ATP Progress / Performance Chart", "Not enough ride history yet.");

  const left = 50;
  const right = W - 60;
  const top = 100;
  const bottom = H - 60;
  const all = points.flatMap((p) => [p.ctl, p.atl, p.tsb]);
  // Always include zero: TSB straddles it, and a zero line the data never
  // reaches would sit outside the plot.
  const min = Math.min(0, ...all);
  const max = Math.max(0, ...all);
  const span = max - min || 1;
  const x = (i: number) => left + (i / (points.length - 1)) * (right - left);
  const y = (v: number) => bottom - ((v - min) / span) * (bottom - top);
  const path = (pick: (p: { ctl: number; atl: number; tsb: number }) => number) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(pick(p)).toFixed(1)}`).join(" ");

  const last = points[points.length - 1];
  const legend = [
    { label: `CTL ${Math.round(last.ctl)}`, color: "#2ee6a6", extra: targets?.ctl != null ? ` (target ${Math.round(targets.ctl)})` : "" },
    { label: `ATL ${Math.round(last.atl)}`, color: "#ffb020", extra: "" },
    { label: `TSB ${Math.round(last.tsb)}`, color: "#4B87F5", extra: targets?.tsb != null ? ` (target ${Math.round(targets.tsb)})` : "" },
  ]
    .map((item, i) => {
      const lx = 50 + i * 210;
      return `<rect x="${lx}" y="${H - 40}" width="12" height="12" rx="3" fill="${item.color}"/>
              <text x="${lx + 20}" y="${H - 29}" fill="${TEXT}" font-family="${FONT}" font-size="16">${esc(item.label)}<tspan fill="${MUTED}">${esc(item.extra)}</tspan></text>`;
    })
    .join("");

  return frame(
    "ATP Progress / Performance Chart",
    `<line x1="${left}" y1="${y(0).toFixed(1)}" x2="${right}" y2="${y(0).toFixed(1)}" stroke="rgba(255,255,255,.15)" stroke-width="1"/>
     <path d="${path((p) => p.ctl)}" fill="none" stroke="#2ee6a6" stroke-width="3" stroke-linejoin="round"/>
     <path d="${path((p) => p.atl)}" fill="none" stroke="#ffb020" stroke-width="2.5" stroke-linejoin="round"/>
     <path d="${path((p) => p.tsb)}" fill="none" stroke="#4B87F5" stroke-width="2.5" stroke-linejoin="round"/>
     <text x="${left - 8}" y="${(y(max) + 5).toFixed(1)}" fill="${MUTED}" font-family="${FONT}" font-size="14" text-anchor="end">${Math.round(max)}</text>
     <text x="${left - 8}" y="${(y(min) + 5).toFixed(1)}" fill="${MUTED}" font-family="${FONT}" font-size="14" text-anchor="end">${Math.round(min)}</text>
     <text x="${left}" y="${bottom + 24}" fill="${MUTED}" font-family="${FONT}" font-size="14">${esc(points[0].date)}</text>
     <text x="${right}" y="${bottom + 24}" fill="${MUTED}" font-family="${FONT}" font-size="14" text-anchor="end">${esc(last.date)}</text>
     ${legend}`,
  );
}

// Whoop's own three-up summary. Colours match the dashboard's rings exactly:
// sleep steel blue, strain blue, and recovery banded red/amber/green - see
// ringColor in DashboardWidget.tsx and recoveryColor in src/utils.
const SLEEP_RING_COLOR = "#8FA9C5";
const STRAIN_RING_COLOR = "#4B87F5";

function recoveryRingColor(score: number): string {
  if (score >= 67) return "#2ee6a6";
  if (score >= 34) return "#ffb020";
  return "#ff4d2e";
}

// Strain is a 0-21 scale, not a percentage, so it fills against 21 rather than
// 100 - otherwise a hard day's 18 would read as a fifth of the ring.
const STRAIN_MAX = 21;

export function ringsRowSvg(day: {
  sleepPerformance: number | null;
  recovery: number | null;
  strain: number | null;
  dateLabel: string;
}): string {
  const rings: { label: string; value: number | null; display: string; fraction: number; color: string }[] = [
    {
      label: "SLEEP",
      value: day.sleepPerformance,
      display: day.sleepPerformance != null ? `${Math.round(day.sleepPerformance)}%` : "—",
      fraction: (day.sleepPerformance ?? 0) / 100,
      color: SLEEP_RING_COLOR,
    },
    {
      label: "RECOVERY",
      value: day.recovery,
      display: day.recovery != null ? `${Math.round(day.recovery)}%` : "—",
      fraction: (day.recovery ?? 0) / 100,
      color: recoveryRingColor(day.recovery ?? 0),
    },
    {
      label: "STRAIN",
      value: day.strain,
      display: day.strain != null ? (Math.round(day.strain * 10) / 10).toString() : "—",
      fraction: (day.strain ?? 0) / STRAIN_MAX,
      color: STRAIN_RING_COLOR,
    },
  ];

  if (rings.every((r) => r.value == null)) {
    return noDataImage("Sleep, Recovery & Strain", "No Whoop reading for that day.");
  }

  const r = 78;
  const circumference = 2 * Math.PI * r;
  const cy = 230;
  const body = rings
    .map((ring, i) => {
      const cx = W / 6 + (i * W) / 3;
      const filled = Math.max(0, Math.min(1, ring.fraction)) * circumference;
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="18"/>
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${ring.color}" stroke-width="18" stroke-linecap="round"
          stroke-dasharray="${filled.toFixed(1)} ${circumference.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>
        <text x="${cx}" y="${cy + 14}" fill="${TEXT}" font-family="${FONT}" font-size="40" font-weight="700" text-anchor="middle">${esc(ring.display)}</text>
        <text x="${cx}" y="${cy + r + 48}" fill="${MUTED}" font-family="${FONT}" font-size="16" letter-spacing="1" text-anchor="middle">${esc(ring.label)}</text>`;
    })
    .join("");

  return frame(
    "Sleep, Recovery & Strain",
    `${body}<text x="40" y="${H - 24}" fill="${MUTED}" font-family="${FONT}" font-size="17">${esc(day.dateLabel)}</text>`,
  );
}
