// Looks for the overlays. One theme is shared by every overlay window: it's
// kept in storage, so choosing it in any overlay's settings changes them all
// (other windows hear about it through the storage event).
//
// A theme sets the colours the overlays are drawn with - the panel
// background, the "ink" for lines and tints (white on dark themes, black on
// light ones), the accent, text - and the fonts, corner rounding and the
// shadow that keeps text readable over Zwift. Colours used in rgba() are
// kept as "r, g, b" so the Background setting can fade them.

export interface Theme {
  id: string;
  name: string;
  bg: string;
  ink: string;
  accent: string;
  /** A second accent, for the few things picked out in it (heart rate, warnings). */
  hot: string;
  amber: string;
  text: string;
  muted: string;
  display: string;
  body?: string;
  radius: string;
  shadow: string;
  /** Dark text on a pale background. */
  light?: boolean;
  /** Google Fonts families to load for the theme, as in the css2 API. */
  fonts?: string[];
  /** Everything in shades of grey, the colours fixed in the overlays (zones, flags, teams) too. */
  grayscale?: boolean;
}

const DARK_SHADOW = "0 1px 2px rgba(0, 0, 0, 0.75)";

export const THEMES: Theme[] = [
  {
    id: "ultra",
    name: "Ultra Cyclist",
    bg: "11, 14, 17",
    ink: "255, 255, 255",
    accent: "46, 230, 166",
    hot: "#ff4d2e",
    amber: "#ffb020",
    text: "#f5f6f7",
    muted: "#9aa4ae",
    display: '"Bebas Neue", "Arial Narrow", sans-serif',
    radius: "10px",
    shadow: DARK_SHADOW,
  },
  {
    id: "midnight",
    name: "Midnight",
    bg: "9, 16, 34",
    ink: "200, 220, 255",
    accent: "77, 163, 255",
    hot: "#ff5c7a",
    amber: "#ffc857",
    text: "#eef3ff",
    muted: "#8ea0c2",
    display: '"Bebas Neue", "Arial Narrow", sans-serif',
    radius: "12px",
    shadow: DARK_SHADOW,
  },
  {
    id: "ember",
    name: "Ember",
    bg: "22, 10, 6",
    ink: "255, 220, 200",
    accent: "255, 106, 46",
    hot: "#ff3b3b",
    amber: "#ffd166",
    text: "#fff3ea",
    muted: "#c09a86",
    display: '"Oswald", "Arial Narrow", sans-serif',
    radius: "8px",
    shadow: DARK_SHADOW,
    fonts: ["Oswald:wght@500"],
  },
  {
    id: "neon",
    name: "Neon",
    bg: "10, 4, 24",
    ink: "230, 200, 255",
    accent: "255, 43, 214",
    hot: "#ff2b6a",
    amber: "#00e5ff",
    text: "#f8eaff",
    muted: "#a58bc4",
    display: '"Orbitron", "Arial Narrow", sans-serif',
    radius: "4px",
    shadow: "0 0 6px rgba(255, 43, 214, 0.6)",
    fonts: ["Orbitron:wght@600"],
  },
  {
    id: "maillot",
    name: "Maillot Jaune",
    bg: "18, 16, 4",
    ink: "255, 245, 200",
    accent: "255, 212, 0",
    hot: "#ff5a36",
    amber: "#ffffff",
    text: "#fffbea",
    muted: "#b8ad7a",
    display: '"Barlow Condensed", "Arial Narrow", sans-serif',
    radius: "6px",
    shadow: DARK_SHADOW,
    fonts: ["Barlow+Condensed:wght@600"],
  },
  {
    id: "giro",
    name: "Maglia Rosa",
    bg: "26, 8, 20",
    ink: "255, 215, 235",
    accent: "255, 95, 162",
    hot: "#ff4d4d",
    amber: "#ffd27a",
    text: "#fff0f6",
    muted: "#c493ab",
    display: '"Teko", "Arial Narrow", sans-serif',
    radius: "10px",
    shadow: DARK_SHADOW,
    fonts: ["Teko:wght@500"],
  },
  {
    id: "kom",
    name: "Polka Dot",
    bg: "250, 250, 250",
    ink: "0, 0, 0",
    accent: "226, 35, 26",
    hot: "#c4120a",
    amber: "#d97a00",
    text: "#141414",
    muted: "#5b5b5b",
    display: '"Russo One", "Arial Narrow", sans-serif',
    radius: "14px",
    shadow: "none",
    light: true,
    fonts: ["Russo+One"],
  },
  {
    id: "arctic",
    name: "Arctic",
    bg: "236, 243, 248",
    ink: "10, 30, 50",
    accent: "0, 119, 204",
    hot: "#d6336c",
    amber: "#c77700",
    text: "#0d1b2a",
    muted: "#4a5d70",
    display: '"Barlow Condensed", "Arial Narrow", sans-serif',
    radius: "10px",
    shadow: "none",
    light: true,
    fonts: ["Barlow+Condensed:wght@600"],
  },
  {
    id: "carbon",
    name: "Carbon",
    bg: "22, 22, 22",
    ink: "255, 255, 255",
    accent: "230, 230, 230",
    hot: "#ff5f5f",
    amber: "#bdbdbd",
    text: "#ffffff",
    muted: "#8c8c8c",
    display: '"Rajdhani", "Arial Narrow", sans-serif',
    radius: "3px",
    shadow: DARK_SHADOW,
    fonts: ["Rajdhani:wght@700"],
  },
  {
    id: "terminal",
    name: "Terminal",
    bg: "0, 8, 0",
    ink: "120, 255, 150",
    accent: "51, 255, 102",
    hot: "#ff5f56",
    amber: "#ffd866",
    text: "#c8ffd4",
    muted: "#5fa86f",
    display: '"VT323", Consolas, monospace',
    body: '"IBM Plex Mono", Consolas, monospace',
    radius: "0",
    shadow: "0 0 4px rgba(51, 255, 102, 0.45)",
    fonts: ["VT323", "IBM+Plex+Mono:wght@400;600"],
  },
  {
    id: "velodrome",
    name: "Velodrome",
    bg: "38, 24, 14",
    ink: "255, 230, 200",
    accent: "242, 165, 65",
    hot: "#e2553a",
    amber: "#f6e7cf",
    text: "#f6e7cf",
    muted: "#b59c7c",
    display: '"Alfa Slab One", Georgia, serif',
    body: 'Georgia, "Times New Roman", serif',
    radius: "6px",
    shadow: DARK_SHADOW,
    fonts: ["Alfa+Slab+One"],
  },
  {
    id: "forest",
    name: "Forest",
    bg: "10, 24, 16",
    ink: "210, 255, 220",
    accent: "123, 211, 137",
    hot: "#ff7a59",
    amber: "#e9c46a",
    text: "#effaf1",
    muted: "#8fb39a",
    display: '"Oswald", "Arial Narrow", sans-serif',
    radius: "12px",
    shadow: DARK_SHADOW,
    fonts: ["Oswald:wght@500"],
  },
  {
    id: "ocean",
    name: "Ocean",
    bg: "4, 22, 32",
    ink: "200, 245, 255",
    accent: "0, 209, 193",
    hot: "#ff6b6b",
    amber: "#ffd23f",
    text: "#eafcff",
    muted: "#82aab5",
    display: '"Rajdhani", "Arial Narrow", sans-serif',
    radius: "16px",
    shadow: DARK_SHADOW,
    fonts: ["Rajdhani:wght@700"],
  },
  {
    id: "sunset",
    name: "Sunset",
    bg: "32, 12, 30",
    ink: "255, 220, 230",
    accent: "255, 164, 92",
    hot: "#ff4f79",
    amber: "#ff8fb1",
    text: "#fff1ec",
    muted: "#c79aa6",
    display: '"Teko", "Arial Narrow", sans-serif',
    radius: "12px",
    shadow: DARK_SHADOW,
    fonts: ["Teko:wght@500"],
  },
  {
    id: "contrast",
    name: "High Contrast",
    bg: "0, 0, 0",
    ink: "255, 255, 255",
    accent: "255, 255, 0",
    hot: "#ff4040",
    amber: "#00ffff",
    text: "#ffffff",
    muted: "#e0e0e0",
    display: '"Bebas Neue", "Arial Narrow", sans-serif',
    radius: "4px",
    shadow: "0 0 2px #000, 0 1px 3px #000",
  },
  {
    id: "mono",
    name: "Black & White",
    bg: "0, 0, 0",
    ink: "255, 255, 255",
    accent: "255, 255, 255",
    hot: "#b8b8b8",
    amber: "#d9d9d9",
    text: "#ffffff",
    muted: "#9a9a9a",
    display: '"Barlow Condensed", "Arial Narrow", sans-serif',
    radius: "4px",
    shadow: DARK_SHADOW,
    fonts: ["Barlow+Condensed:wght@600"],
    grayscale: true,
  },
];

export const THEME_KEY = "overlay:theme";

export function readTheme(): Theme {
  try {
    const id = window.localStorage.getItem(THEME_KEY);
    return THEMES.find((t) => t.id === id) ?? THEMES[0];
  } catch {
    return THEMES[0];
  }
}

export function saveTheme(id: string) {
  try {
    window.localStorage.setItem(THEME_KEY, id);
  } catch {
    // Unavailable - the theme just won't stick or reach the other windows.
  }
}

/** Puts a theme's colours and fonts on the page, loading its fonts if it has any. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement.style;
  const vars: Record<string, string> = {
    "--hud-bg": theme.bg,
    "--hud-ink": theme.ink,
    "--hud-accent": theme.accent,
    "--hud-shadow": theme.shadow,
    "--color-bg": `rgb(${theme.bg})`,
    "--color-border": `rgba(${theme.ink}, 0.14)`,
    "--color-accent": theme.hot,
    "--color-accent-2": `rgb(${theme.accent})`,
    "--color-amber": theme.amber,
    "--color-text": theme.text,
    "--color-text-muted": theme.muted,
    "--font-display": theme.display,
    "--font-body": theme.body ?? '"Inter", system-ui, -apple-system, sans-serif',
    "--radius": theme.radius,
  };
  for (const [k, v] of Object.entries(vars)) root.setProperty(k, v);
  document.documentElement.toggleAttribute("data-hud-light", !!theme.light);
  root.filter = theme.grayscale ? "grayscale(1)" : "";
  document.getElementById("hud-theme-fonts")?.remove();
  if (theme.fonts?.length) {
    const link = document.createElement("link");
    link.id = "hud-theme-fonts";
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?${theme.fonts.map((f) => `family=${f}`).join("&")}&display=swap`;
    document.head.appendChild(link);
  }
}
