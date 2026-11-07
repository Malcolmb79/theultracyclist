import { useId } from "react";

// Zwift's power-ups as round game badges: a glossy disc in the power-up's own
// colour, a white rim and a bold white symbol - drawn for the mod (not
// Zwift's art), readable from a 12px arch marker to a full window. Unknown
// ones fall back to a green bolt.

interface Glyph {
  /** Solid white shapes. */
  fill: string[];
  /** Details cut back into them, in the disc's colour. */
  cut?: string[];
  /** White lines (handles, steam). */
  line?: string[];
}

const GLYPHS: Record<string, Glyph> = {
  // A feather.
  LIGHTNESS: { fill: ["M20 3C12 3.5 6.5 8.5 6 16l-2.5 4.5 1 1L9 19c7.5-.5 12-6 11-16z"], cut: ["M8.5 17.5L17 7"] },
  // The draft van, from the side.
  DRAFTBOOST: {
    fill: ["M1.5 6.5h13l5 4.5h3v6.5h-1.6a2.9 2.9 0 0 0-5.8 0H9.4a2.9 2.9 0 0 0-5.8 0H1.5z", "M4.5 17.5a2 2 0 1 0 4 0 2 2 0 1 0-4 0", "M15 17.5a2 2 0 1 0 4 0 2 2 0 1 0-4 0"],
    cut: ["M15 8.2v3.3h3.7z"],
  },
  // An aero road helmet.
  AERO: { fill: ["M1.5 15.5C2 9.5 6.5 5.5 12.5 5.5c5 0 8.5 3 10 7.5l-4.5 2.5z"], cut: ["M6 12.5c2-2.5 5-4 8.5-4", "M4 15.5h13"] },
  // A burrito, wrapped.
  UNDRAFTABLE: { fill: ["M4.5 16.5L15.5 5.5a3.9 3.9 0 0 1 5.5 5.5L10 22a3.9 3.9 0 0 1-5.5-5.5z"], cut: ["M8.5 13.5l2.5 2.5", "M12 10l2.5 2.5", "M15.5 6.5L18 9"] },
  // A ghost.
  NINJA: { fill: ["M4.5 21.5V10a7.5 7.5 0 0 1 15 0v11.5l-2.5-2-2.5 2-2.5-2-2.5 2-2.5-2z"], cut: ["M9.5 10.5h.01", "M14.5 10.5h.01"] },
  // A road roller.
  STEAMROLLER: {
    fill: ["M2.5 17a4.5 4.5 0 1 0 9 0 4.5 4.5 0 1 0-9 0", "M9.5 10h8.5v10H9.5z", "M17 18.5a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0", "M12.5 3.5h3V10h-3z"],
    cut: ["M5.5 17a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0"],
  },
  // An anvil.
  ANVIL: { fill: ["M2 7h14c3 0 5-1 6-2v5c-2 1.5-4 2.5-6.5 2.5l-1 2.5h3v4H6.5v-4h3l-1-2.5C5 12.5 2 10.5 2 7z"] },
  // A cup of coffee.
  COFFEE_STOP: { fill: ["M4 9h12.5v6.5A4.5 4.5 0 0 1 12 20H8.5A4.5 4.5 0 0 1 4 15.5z"], line: ["M16.5 11h1.8a2.2 2.2 0 0 1 0 4.4h-1.8", "M8 3.5c-.8 1 .8 2 0 3", "M12.5 3.5c-.8 1 .8 2 0 3"] },
};
const BOLT: Glyph = { fill: ["M13.5 2L4.5 14h6.5l-1.5 8L19 9.5h-6.5z"] };

/** Each power-up's own colour, as Zwift tells them apart. */
export const POWER_UP_COLOURS: Record<string, string> = {
  LIGHTNESS: "#8b5cf6",
  DRAFTBOOST: "#1f9de0",
  AERO: "#f5a524",
  UNDRAFTABLE: "#e8512e",
  NINJA: "#4f6a8f",
  STEAMROLLER: "#ef7d1a",
  ANVIL: "#6f7883",
  COFFEE_STOP: "#8b5a3c",
};
const BOLT_COLOUR = "#22b573";

export const powerUpColour = (code: string) => POWER_UP_COLOURS[code] ?? BOLT_COLOUR;

/** The draining ring's radius and length, in the badge's 24-unit box. */
const RING_R = 11.1;
const RING_C = 2 * Math.PI * RING_R;

/**
 * left: how much of a running power-up is left (1 to 0) - a ring round the
 * badge drains away clockwise from the top, as Zwift's does.
 */
export default function PowerUpIcon({ code, size = 22, left }: { code: string; size?: number; left?: number }) {
  const id = `pu-${useId().replace(/:/g, "")}`;
  const g = GLYPHS[code] ?? BOLT;
  const colour = powerUpColour(code);
  // Fine detail only where there's room for it.
  const ring = left != null;
  const rim = size < 16 ? 1.6 : 1.3;
  // With a ring, the disc is a little smaller to make room for it outside.
  const r = ring ? 9.2 : 12 - rim / 2;
  const glyph = (size < 24 ? 0.68 : 0.58) * (ring ? 0.85 : 1);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ overflow: "visible" }}>
      <defs>
        <radialGradient id={id} cx="35%" cy="28%" r="80%">
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.3" />
        </radialGradient>
      </defs>
      <circle cx="12" cy="12" r={r} fill={colour} />
      <circle cx="12" cy="12" r={r} fill={`url(#${id})`} />
      {!ring && <circle cx="12" cy="12" r={r} fill="none" stroke="#fff" strokeWidth={rim} />}
      {ring && (
        <>
          <circle cx="12" cy="12" r={RING_R} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={1.8} />
          <circle
            cx="12"
            cy="12"
            r={RING_R}
            fill="none"
            stroke="#fff"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C * (1 - Math.max(0, Math.min(1, left)))}
            transform="rotate(-90 12 12)"
            style={{ transition: "stroke-dashoffset 1s linear" }}
          />
        </>
      )}
      <g transform={`translate(12 12) scale(${glyph}) translate(-12 -12)`} filter="drop-shadow(0 0.6px 0.6px rgba(0,0,0,0.35))">
        {g.fill.map((d) => (
          <path key={d} d={d} fill="#fff" />
        ))}
        {g.cut?.map((d) => (
          <path key={d} d={d} fill={colour} stroke={colour} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {g.line?.map((d) => (
          <path key={d} d={d} fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" />
        ))}
      </g>
    </svg>
  );
}
