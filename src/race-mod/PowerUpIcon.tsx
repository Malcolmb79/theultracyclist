// Zwift's power-ups drawn in The Ultra Cyclist's line style: one stroke
// weight, round caps, the colour from the badge they sit in. Unknown ones
// fall back to a bolt.

const PATHS: Record<string, string[]> = {
  // A quill feather.
  LIGHTNESS: ["M19 4c-6 1-11 6-12 13", "M19 4c1 6-3 11-9 12", "M7 17l-3 3", "M10 11h5", "M9 14h4"],
  // The van, from the side.
  DRAFTBOOST: ["M3 16V8h11l4 4h3v4", "M3 16h18", "M14 8v4h4", "M7 16a2 2 0 1 0 0.01 0", "M17 16a2 2 0 1 0 0.01 0"],
  // A rider's head in profile, in an aero helmet.
  AERO: ["M7 13.5a4.5 4.5 0 1 0 9 0", "M5.5 12.5c1-5 6-7 10-6 3 .8 5.5 3 7 6l-7 1z", "M10 16h2"],
  // A wrapped burrito.
  UNDRAFTABLE: ["M5 17L17 5a3 3 0 0 1 4 4L9 21a3 3 0 0 1-4-4z", "M9 13l2 2", "M12 10l2 2", "M15 7l2 2"],
  // A ghost.
  NINJA: ["M6 20V10a6 6 0 0 1 12 0v10l-2-2-2 2-2-2-2 2-2-2z", "M10 10h0.01", "M14 10h0.01"],
  // A road roller.
  STEAMROLLER: ["M4 18a3 3 0 1 0 6 0 3 3 0 1 0-6 0", "M10 18h6V9h-5l-2 4", "M16 18a2 2 0 1 0 4 0 2 2 0 1 0-4 0", "M13 9V5h3"],
  // An anvil.
  ANVIL: ["M3 8h13a5 5 0 0 0 5-2v4c-2 1-4 2-6 2l-1 3h3v3H7v-3h3l-1-3c-3 0-6-2-6-4z"],
  // A cup of coffee.
  COFFEE_STOP: ["M5 9h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z", "M16 11h2a2 2 0 0 1 0 4h-2", "M8 5c0 1 1 1 1 2", "M12 5c0 1 1 1 1 2"],
};
// A lightning bolt, for the boost and anything new.
const BOLT = ["M13 3L5 14h6l-1 7 8-11h-6z"];

export default function PowerUpIcon({ code, size = 22 }: { code: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {(PATHS[code] ?? BOLT).map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
