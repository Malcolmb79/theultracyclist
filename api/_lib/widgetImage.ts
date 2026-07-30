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
export const IMAGEABLE_METRICS = new Set(["health.bmi", "health.macroSplit", "health.caloriesBalance"]);
