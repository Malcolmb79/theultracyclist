// Zwift's power-ups by the names riders know them by, rather than the codes
// Zwift and Sauce use for them (LIGHTNESS is the Feather, DRAFTBOOST the
// Van), with what each one does - so the commentator and coach can talk
// about them the way a Zwift racer would.

interface PowerUp {
  name: string;
  /** What it does, in a few words a commentator could use. */
  effect: string;
}

const POWER_UPS: Record<string, PowerUp> = {
  LIGHTNESS: { name: "Feather", effect: "about 10% lighter for around 15 seconds - made for a steep pitch" },
  DRAFTBOOST: { name: "Van", effect: "a much bigger draft for around 30 seconds - for sitting in or bridging on a wheel" },
  AERO: { name: "Aero helmet", effect: "more aero for around 30 seconds - for the flat and the sprint" },
  UNDRAFTABLE: { name: "Burrito", effect: "no draft for anyone behind for a few seconds - for getting away" },
  NINJA: { name: "Ghost", effect: "invisible to the riders around for a few seconds - for a surprise attack" },
  STEAMROLLER: { name: "Steamroller", effect: "heavier, so faster downhill, and no draft for anyone behind" },
  ANVIL: { name: "Anvil", effect: "much heavier for a while - for descending fast" },
  COFFEE_STOP: { name: "Coffee stop", effect: "stopped for a coffee break" },
  BOOST: { name: "Boost", effect: "a short boost" },
};

/** Power-ups that do nothing for the race itself. */
const NOT_RACING = new Set(["BONUS_XP", "BONUS_XP_LIGHT", "POWERUP_NONE"]);

/** The power-up as riders know it, or undefined for none or a non-racing one. */
export function powerUp(code: string | undefined): PowerUp | undefined {
  if (!code || NOT_RACING.has(code)) return undefined;
  return POWER_UPS[code] ?? { name: code.toLowerCase().replace(/_/g, " "), effect: "" };
}
