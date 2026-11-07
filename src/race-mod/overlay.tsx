import { Component, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import styles from "./Overlay.module.css";
import { THEMES, THEME_KEY, applyTheme, readTheme, saveTheme } from "./themes";
import { MAX_HR_KEY, maxHrSetting, saveMaxHrSetting } from "./zones";

// The theme goes on before the first paint, so an overlay never flashes the default look.
applyTheme(readTheme());

// The frame every Ultra Cyclist overlay sits in, so they look and behave
// alike: a background that fades down to nothing so Zwift shows through,
// and - shown on hover, as on the site's dashboards - a ☰ handle in the
// corner to drag the window by or click for its settings, and a corner to
// drag for its size. The settings open in a window of their own (or on
// right-click), so the overlay stays where it is.
//
// The handle moves the window itself rather than being a system drag area:
// a drag area never hears a click, and the handle needs both.

export type SettingValue = boolean | number | string;

export interface SettingDef {
  key: string;
  label: string;
  type: "toggle" | "select" | "range" | "text";
  options?: { value: SettingValue; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  /** For text: a hint shown while it's empty. */
  placeholder?: string;
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
  // Changed in another window - the overlay's settings window - shown here
  // at once. Sauce doesn't always pass the browser's storage notice between
  // its windows, so the stored settings are also checked every second.
  useEffect(() => {
    let last = (() => {
      try {
        return window.localStorage.getItem(storageKey);
      } catch {
        return null;
      }
    })();
    const poll = setInterval(() => {
      let now: string | null = null;
      try {
        now = window.localStorage.getItem(storageKey);
      } catch {
        return;
      }
      if (now === last || now == null) return;
      last = now;
      window.dispatchEvent(new StorageEvent("storage", { key: storageKey, newValue: now }));
    }, 1000);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== storageKey || e.newValue == null) return;
      last = e.newValue;
      try {
        const stored = JSON.parse(e.newValue) as Record<string, unknown>;
        setValues((v) => {
          const next = { ...v };
          for (const k of Object.keys(defaults) as (keyof T)[]) {
            if (typeof stored[k as string] === typeof defaults[k]) next[k] = stored[k as string] as T[keyof T];
          }
          return next;
        });
      } catch {
        // Not readable: kept as it is.
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      clearInterval(poll);
      window.removeEventListener("storage", onStorage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
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
  /** How many settings rows the extra settings take, for sizing the window to the menu. */
  extraRows?: number;
  /** A wider settings menu, for overlays with a lot to choose. */
  menuWidth?: number;
  className?: string;
  children: ReactNode;
}

const MENU_WIDTH = 280;
/** The menu's rows are about this tall, in pixels, for sizing the window to it. */
const ROW_PX = 31;
/** This page opened as an overlay's settings window: the menu is the whole page. */
const SETTINGS_MODE = new URLSearchParams(window.location.search).has("settings");
const IN_SAUCE = /electron|sauce/i.test(navigator.userAgent);

export function OverlayShell<T extends Record<string, SettingValue>>({
  title,
  settings,
  setSetting,
  defs,
  extraSettings,
  extraRows,
  menuWidth = MENU_WIDTH,
  className,
  children,
}: ShellProps<T>) {
  const [menu, setMenu] = useState(SETTINGS_MODE);
  // Where the window was before the menu took it to the middle of the screen.
  const before = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const [theme, setTheme] = useState(() => readTheme().id);
  const [textSize, setTextSize] = useState(() => readTextSize(title));
  const [maxHr, setMaxHr] = useState(() => maxHrSetting());
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
      // Not while the settings have the window in the middle of the screen.
      if (before.current) return;
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
    // A settings window stays at normal size; the overlay it's for takes the text size.
    document.documentElement.style.fontSize = SETTINGS_MODE ? "100%" : `${textSize}%`;
    try {
      window.localStorage.setItem(textKey(title), String(textSize));
    } catch {
      // Unavailable - the size just won't stick.
    }
    // Layouts that measure themselves (groups) hear about it as a resize.
    window.dispatchEvent(new Event("resize"));
  }, [textSize, title]);

  // Another overlay changing the theme changes this one too - and this
  // overlay's own settings window changing its text size or the max heart rate.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === textKey(title)) {
        setTextSize(readTextSize(title));
        return;
      }
      if (e.key === MAX_HR_KEY) {
        setMaxHr(maxHrSetting());
        return;
      }
      if (e.key !== THEME_KEY) return;
      const next = readTheme();
      applyTheme(next);
      setTheme(next.id);
    };
    window.addEventListener("storage", onStorage);
    // And checked every second, for when Sauce doesn't pass the notice on.
    const poll = setInterval(() => {
      if (SETTINGS_MODE) return;
      setTextSize((was) => {
        const v = readTextSize(title);
        return v === was ? was : v;
      });
      setMaxHr((was) => {
        const v = maxHrSetting();
        return v === was ? was : v;
      });
      const next = readTheme();
      setTheme((was) => {
        if (was === next.id) return was;
        applyTheme(next);
        return next.id;
      });
    }, 1000);
    return () => {
      clearInterval(poll);
      window.removeEventListener("storage", onStorage);
    };
  }, [title]);

  useEffect(() => {
    // A settings window has a background of its own; an overlay is see-through.
    if (!SETTINGS_MODE) document.documentElement.classList.add(styles.transparent);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The settings open in a window of their own (Sauce opens the overlay's
  // own page again, in settings-only mode, beside it): the overlay stays
  // exactly where it is and changes show on it as they're made. In settings
  // mode the menu is the whole page. Outside Sauce, where a browser blocks
  // the window, the overlay's own window is taken to the middle and made big
  // enough instead, then put back exactly where it was.
  const rows = 6 + defs.length + (extraRows ?? (extraSettings ? 3 : 0));
  const scr = window.screen as Screen & { availLeft?: number; availTop?: number };

  const openInMiddle = () => {
    if (!before.current) {
      before.current = { x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight };
      const w = Math.min(scr.availWidth - 40, Math.max(menuWidth + 40, before.current.w));
      const h = Math.min(scr.availHeight - 60, Math.max(before.current.h, 90 + rows * ROW_PX));
      try {
        window.resizeTo(w, h);
        window.moveTo((scr.availLeft ?? 0) + Math.round((scr.availWidth - w) / 2), (scr.availTop ?? 0) + Math.round((scr.availHeight - h) / 2));
      } catch {
        // Not allowed: the menu scrolls inside the window.
      }
    }
    setMenu(true);
  };

  const openMenu = () => {
    if (SETTINGS_MODE) return;
    const w = Math.min(scr.availWidth - 40, menuWidth + 40);
    const h = Math.min(scr.availHeight - 60, 90 + rows * ROW_PX);
    const url = `${location.pathname}?settings=1&frame=false&child-window&width=${w}&height=${h}`;
    let opened: Window | null = null;
    try {
      opened = window.open(url, `uc-settings-${title.replace(/\W+/g, "-")}`, `popup=yes,width=${w},height=${h}`);
    } catch {
      opened = null;
    }
    // Sauce opens it itself and hands back nothing; a browser hands back the window, or nothing if it blocked it.
    if (!opened && !IN_SAUCE) openInMiddle();
  };

  const closeMenu = () => {
    if (SETTINGS_MODE) {
      window.close();
      return;
    }
    setMenu(false);
    const was = before.current;
    if (!was) return;
    try {
      window.resizeTo(was.w, was.h);
      window.moveTo(was.x, was.y);
    } catch {
      // Not allowed: it was never moved.
    }
    // Give the window a moment to settle back before the overlay measures itself again.
    setTimeout(() => {
      before.current = null;
    }, 400);
  };

  // The corner handle: dragged, it moves the window; clicked, it opens the settings.
  const dragWindow = (e: React.PointerEvent, resize: boolean) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const start = { sx: e.screenX, sy: e.screenY, x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight };
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.screenX - start.sx;
      const dy = ev.screenY - start.sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      moved = true;
      try {
        if (resize) window.resizeTo(Math.max(80, start.w + dx), Math.max(24, start.h + dy));
        else window.moveTo(start.x + dx, start.y + dy);
      } catch {
        // Not allowed here.
      }
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      if (!moved && !resize) openMenu();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const closeRef = useRef(closeMenu);
  closeRef.current = closeMenu;

  return (
    <div
      ref={shellRef}
      className={`${styles.shell} ${className ?? ""}`}
      style={{ ["--overlay-alpha" as string]: String(settings.opacity / 100) }}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu();
      }}
    >
      {!SETTINGS_MODE && (
        <>
          <button
            type="button"
            className={styles.handle}
            title="Drag to move · click for settings"
            aria-label={`Move ${title}, or click for its settings`}
            onPointerDown={(e) => dragWindow(e, false)}
          >
            ☰
          </button>
          <span className={styles.resize} title="Drag to resize" aria-hidden onPointerDown={(e) => dragWindow(e, true)} />
        </>
      )}
      {!SETTINGS_MODE && <Recover>{children}</Recover>}
      {clipped && (
        <div className={styles.more} title="There's more below - drag the window's bottom edge down to see it">
          ↓ more
        </div>
      )}
      {menu &&
        (() => {
          const content = (
        <>
          <div className={styles.backdrop} onMouseDown={closeMenu} onContextMenu={(e) => e.preventDefault()} />
          <div className={styles.menu} style={{ width: menuWidth }} role="dialog" aria-label={`${title} settings`}>
            <div className={styles.menuTitle}>
              {title}
              <button type="button" className={styles.close} onClick={closeMenu} aria-label="Close settings">
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
            <label className={styles.row}>
              <span className={styles.label}>Max heart rate, for zone colours (all overlays)</span>
              <select
                value={maxHr}
                onChange={(e) => {
                  saveMaxHrSetting(e.target.value);
                  setMaxHr(e.target.value);
                }}
              >
                <option value="strava">My max over the last 90 days (Strava)</option>
                <option value="learn">Learn from my rides here</option>
                {Array.from({ length: 61 }, (_, i) => 150 + i).map((v) => (
                  <option key={v} value={v}>
                    {v} bpm
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
                  ) : d.type === "text" ? (
                    <input
                      type="text"
                      className={styles.text}
                      value={String(value ?? "")}
                      placeholder={d.placeholder}
                      spellCheck={false}
                      onChange={(e) => setSetting(d.key as keyof T, e.target.value)}
                    />
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
          );
          return SETTINGS_MODE ? <div className={styles.settingsPage}>{content}</div> : content;
        })()}
    </div>
  );
}

/**
 * If an overlay's content ever throws, it's drawn again a moment later
 * rather than leaving the window blank for the rest of the ride.
 */
export class Recover extends Component<{ children: ReactNode }, { failed: boolean; round: number }> {
  state = { failed: false, round: 0 };
  private timer: ReturnType<typeof setTimeout> | undefined;

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Overlay error - redrawing", error);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.setState((s) => ({ failed: false, round: s.round + 1 })), 1000);
  }

  componentWillUnmount() {
    clearTimeout(this.timer);
  }

  render() {
    return this.state.failed ? null : <RecoverRound key={this.state.round}>{this.props.children}</RecoverRound>;
  }
}

function RecoverRound({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
