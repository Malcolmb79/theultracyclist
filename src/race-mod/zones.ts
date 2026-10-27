// Coggan power zones, as a share of FTP, with the colour Zwift uses for each -
// shared by the power overlay and the workout strip.

export const POWER_ZONES = [
  { upTo: 0.6, name: "Z1", color: "#9aa4ae" },
  { upTo: 0.76, name: "Z2", color: "#3b82f6" },
  { upTo: 0.9, name: "Z3", color: "#2ee6a6" },
  { upTo: 1.05, name: "Z4", color: "#ffd23f" },
  { upTo: 1.18, name: "Z5", color: "#ff9a2e" },
  { upTo: Infinity, name: "Z6", color: "#ff4d2e" },
];

export function zoneColor(share: number): string {
  return (POWER_ZONES.find((z) => share <= z.upTo) ?? POWER_ZONES[POWER_ZONES.length - 1]).color;
}
