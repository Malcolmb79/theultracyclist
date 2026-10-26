import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import styles from "./Overlay.module.css";
import { THEMES, THEME_KEY, applyTheme, readTheme, saveTheme } from "./themes";

// The theme goes on before the first paint, so an overlay never flashes the default look.
applyTheme(readTheme());

// The frame every Ultra Cyclist overlay sits in, so they look and behave
// alike: a background that fades down to nothing so Zwift shows through,
// settings on right-click rather than a button on every overlay, and a grip
// along the top edge, shown on hover, to drag the window by.
//
// Why a grip rather than dragging anywhere: on Windows, right-clicking the
// part of a frameless window that drags it opens the system's window menu
// and the page never hears the click - so the draggable part has to be kept
// to a strip, and the rest left free for the settings menu.

export type SettingValue = boolean | number | string;

export interface SettingDef {
  key: string;
  label: string;
  type: "toggle" | "select" | "range";
  options?: { value: SettingValue; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}

/**
 * An overlay's settings, kept in this window's storage under its own name.
 * Stored values that no longer fit (a setting renamed, a type changed) fall
 * back to the defaults rather than breaking the overlay.
 */
export function useSettings<T extends Record<string, SettingValue>>(
  id: string,
  defaults: T,
): [T, (key: keyof T, value: SettingValue) => void] {
  const storageKey = `overlay:${id}`;
  const [values, setValues] = useState<T>(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}") as Record<string, unknown>;
      const merged = { ...defaults };
      for (const k of Object.keys(defaults) as (keyof T)[]) {
        if (typeof stored[k as string] === typeof defaults[k]) merged[k] = stored[k as string] as T[keyof T];
      }
      return merged;
    } catch {
      return defaults;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(values));
    } catch {
      // Full or unavailable - the settings just won't stick.
    }
  }, [storageKey, values]);
  return [values, (key, value) => setValues((v) => ({ ...v, [key]: value }))];
}

/** Every overlay's background setting, the same everywhere. */
export const OPACITY_SETTING: SettingDef = { key: "opacity", label: "Background", type: "range", min: 0, max: 100, step: 5, suffix: "%" };

/**
 * Each window's text size, as a percentage. Kept apart from an overlay's own
 * settings (under its title) so every overlay gets it without declaring it.
 * Overlay sizes are in rem, so scaling the root font scales the lot.
 */
const TEXT_SIZES = [70, 80, 90, 100, 110, 125, 150, 175, 200];

function textKey(title: string) {
  return `overlay-text:${title}`;
}

function readTextSize(title: string): number {
  try {
    const v = Number(window.localStorage.getItem(textKey(title)));
    return TEXT_SIZES.includes(v) ? v : 100;
  } catch {
    return 100;
  }
}

/** The text size as a factor (1 = normal), for layouts that measure in pixels. */
export function textScale(): number {
  return (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) / 16;
}

interface ShellProps<T extends Record<string, SettingValue>> {
  title: string;
  settings: T & { opacity: number };
  setSetting: (key: keyof T, value: SettingValue) => void;
  defs: SettingDef[];
  /** Extra settings an overlay draws itself, below the standard ones. */
  extraSettings?: ReactNode;
  className?: string;
  children: ReactNode;
}

const MENU_WIDTH = 240;
/** Roughly how tall the menu is, so it opens where it fits; small windows scroll it. */
const MENU_HEIGHT = 280;

export function OverlayShell<T extends Record<string, SettingValue>>({
  title,
  settings,
  setSetting,
  defs,
  extraSettings,
  className,
  children,
}: ShellProps<T>) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [theme, setTheme] = useState(() => readTheme().id);
  const [textSize, setTextSize] = useState(() => readTextSize(title));
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [clipped, setClipped] = useState(false);
  // Grown once at most: an overlay sized to the window grows with it, so more would never end.
  const grown = useRef(false);

  // Overlays never scroll, so content taller than the window would be lost
  // off the bottom (a window sized before a new row was added, a bigger
  // text size). Grow the window to fit where Sauce lets the page resize
  // it, and otherwise show that there's more, to drag the edge down to.
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    // How much taller the page is than the window. Measured on the page as
    // it is - wrapping the overlay to measure it would change its layout.
    const overflow = () => document.documentElement.scrollHeight - window.innerHeight;
    const check = () => {
      const over = overflow();
      if (over > 6 && !grown.current) {
        grown.current = true;
        try {
          window.resizeTo(window.outerWidth, Math.min(window.screen.availHeight, window.outerHeight + over + 4));
        } catch {
          // Not allowed - the hint says what to do.
        }
      }
      // Measured again once any resize has landed.
      requestAnimationFrame(() => setClipped(overflow() > 6));
    };
    const ro = new ResizeObserver(check);
    ro.observe(el);
    window.addEventListener("resize", check);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", check);
    };
  }, []);

  useLayoutEffect(() => {
    document.documentElement.style.fontSize = `${textSize}%`;
    try {
      window.localStorage.setItem(textKey(title), String(textSize));
    } catch {
      // Unavailable - the size just won't stick.
    }
    // Layouts that measure themselves (groups) hear about it as a resize.
    window.dispatchEvent(new Event("resize"));
  }, [textSize, title]);

  // Another overlay changing the theme changes this one too.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_KEY) return;
      const next = readTheme();
      applyTheme(next);
      setTheme(next.id);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    document.documentElement.classList.add(styles.transparent);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      ref={shellRef}
      className={`${styles.shell} ${className ?? ""}`}
      style={{ ["--overlay-alpha" as string]: String(settings.opacity / 100) }}
      onContextMenu={(e) => {
        e.preventDefault();
        // Kept inside the window, which may be small - then it starts at the
        // top and scrolls.
        setMenu({
          x: Math.max(4, Math.min(e.clientX, window.innerWidth - MENU_WIDTH - 4)),
          y: Math.max(4, Math.min(e.clientY, window.innerHeight - MENU_HEIGHT - 4)),
        });
      }}
    >
      <div className={styles.grip} title="Drag to move" aria-hidden />
      {children}
      {clipped && (
        <div className={styles.more} title="There's more below - drag the window's bottom edge down to see it">
          ↓ more
        </div>
      )}
      {menu && (
        <>
          <div className={styles.backdrop} onMouseDown={() => setMenu(null)} onContextMenu={(e) => e.preventDefault()} />
          <div className={styles.menu} style={{ left: menu.x, top: menu.y, width: MENU_WIDTH }} role="dialog" aria-label={`${title} settings`}>
            <div className={styles.menuTitle}>
              {title}
              <button type="button" className={styles.close} onClick={() => setMenu(null)} aria-label="Close settings">
                ×
              </button>
            </div>
            <label className={styles.row}>
              <span className={styles.label}>Theme (all overlays)</span>
              <select
                value={theme}
                onChange={(e) => {
                  const next = THEMES.find((t) => t.id === e.target.value) ?? THEMES[0];
                  saveTheme(next.id);
                  applyTheme(next);
                  setTheme(next.id);
                }}
              >
                {THEMES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.row}>
              <span className={styles.label}>Text size</span>
              <select value={textSize} onChange={(e) => setTextSize(Number(e.target.value))}>
                {TEXT_SIZES.map((v) => (
                  <option key={v} value={v}>
                    {v}%
                  </option>
                ))}
              </select>
            </label>
            {[OPACITY_SETTING, ...defs].map((d) => {
              const value = settings[d.key as keyof T];
              return (
                <label key={d.key} className={styles.row}>
                  <span className={styles.label}>{d.label}</span>
                  {d.type === "toggle" ? (
                    <input type="checkbox" checked={!!value} onChange={(e) => setSetting(d.key as keyof T, e.target.checked)} />
                  ) : d.type === "range" ? (
                    <>
                      <input
                        type="range"
                        min={d.min}
                        max={d.max}
                        step={d.step}
                        value={Number(value)}
                        onChange={(e) => setSetting(d.key as keyof T, Number(e.target.value))}
                      />
                      <span className={styles.value}>
                        {String(value)}
                        {d.suffix}
                      </span>
                    </>
                  ) : (
                    <select
                      value={String(value)}
                      onChange={(e) => {
                        const opt = d.options?.find((o) => String(o.value) === e.target.value);
                        if (opt) setSetting(d.key as keyof T, opt.value);
                      }}
                    >
                      {d.options?.map((o) => (
                        <option key={String(o.value)} value={String(o.value)}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
              );
            })}
            {extraSettings}
          </div>
        </>
      )}
    </div>
  );
}
