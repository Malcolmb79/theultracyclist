export type WeatherKind = "clear" | "partlyCloudy" | "cloudy" | "fog" | "rain" | "snow" | "storm";

interface WeatherIconProps {
  kind: WeatherKind;
  size?: number;
}

const SUN_COLOR = "#ffc94d";
const CLOUD_COLOR = "#e8edf4";
const CLOUD_SHADOW = "#c3ccd9";

function Sun({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const rayLength = r * 0.55;
  const rays = Array.from({ length: 8 }, (_, i) => {
    const angle = (i * Math.PI) / 4;
    const x1 = cx + Math.cos(angle) * (r + 4);
    const y1 = cy + Math.sin(angle) * (r + 4);
    const x2 = cx + Math.cos(angle) * (r + 4 + rayLength);
    const y2 = cy + Math.sin(angle) * (r + 4 + rayLength);
    return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={SUN_COLOR} strokeWidth={r * 0.12} strokeLinecap="round" />;
  });
  return (
    <>
      {rays}
      <circle cx={cx} cy={cy} r={r} fill={SUN_COLOR} />
    </>
  );
}

function Cloud({ cx, cy, scale = 1, color = CLOUD_COLOR }: { cx: number; cy: number; scale?: number; color?: string }) {
  return (
    <g transform={`translate(${cx} ${cy}) scale(${scale})`}>
      <ellipse cx={-14} cy={4} rx={13} ry={11} fill={color} />
      <ellipse cx={6} cy={-4} rx={17} ry={15} fill={color} />
      <ellipse cx={22} cy={6} rx={13} ry={10} fill={color} />
      <rect x={-14} y={4} width={36} height={12} fill={color} />
    </g>
  );
}

// Flat, custom-drawn condition icons (not a photorealistic asset pack) -
// mirrors the visual language of a typical weather-app hero icon (sun/cloud
// combinations, rain/snow/lightning glyphs) while staying dependency-free.
export default function WeatherIcon({ kind, size = 72 }: WeatherIconProps) {
  const vb = 100;
  const half = vb / 2;

  const body = (() => {
    switch (kind) {
      case "clear":
        return <Sun cx={half} cy={half} r={22} />;
      case "partlyCloudy":
        return (
          <>
            <Sun cx={38} cy={38} r={16} />
            <Cloud cx={54} cy={60} scale={1.15} />
          </>
        );
      case "cloudy":
        return (
          <>
            <Cloud cx={40} cy={50} scale={0.9} color={CLOUD_SHADOW} />
            <Cloud cx={58} cy={58} scale={1.15} />
          </>
        );
      case "fog":
        return (
          <>
            <Cloud cx={50} cy={44} scale={1.05} />
            {[62, 74, 86].map((y) => (
              <line key={y} x1={22} y1={y} x2={78} y2={y} stroke={CLOUD_SHADOW} strokeWidth={4} strokeLinecap="round" />
            ))}
          </>
        );
      case "rain":
        return (
          <>
            <Cloud cx={50} cy={40} scale={1.1} />
            {[-14, 4, 22].map((dx) => (
              <line
                key={dx}
                x1={50 + dx}
                y1={64}
                x2={50 + dx - 6}
                y2={80}
                stroke="#4B87F5"
                strokeWidth={4}
                strokeLinecap="round"
              />
            ))}
          </>
        );
      case "snow":
        return (
          <>
            <Cloud cx={50} cy={40} scale={1.1} />
            {[-14, 4, 22].map((dx) => (
              <circle key={dx} cx={50 + dx} cy={74} r={3.5} fill="#c9dcf5" />
            ))}
          </>
        );
      case "storm":
        return (
          <>
            <Cloud cx={50} cy={38} scale={1.1} color={CLOUD_SHADOW} />
            <polygon points="52,58 40,80 50,80 44,96 66,70 54,70 60,58" fill="#ffc94d" />
          </>
        );
      default:
        return null;
    }
  })();

  return (
    <svg width={size} height={size} viewBox={`0 0 ${vb} ${vb}`} aria-hidden="true">
      {body}
    </svg>
  );
}
