import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./Overlay.module.css";
import { THEMES, THEME_KEY, applyTheme, readTheme, saveTheme } from "./themes";
import { maxHrSetting, saveMaxHrSetting } from "./zones";

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
  const [menu, setMenu] = useState(false);
  // Move mode: the whole window becomes the handle to drag it by.
  const [moving, setMoving] = useState(false);
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMoving(false);
      closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The settings open in a window of their own in the middle of the screen,
  // drawn by this overlay, so the overlay stays exactly where it is. Where
  // Sauce won't open one (or it comes up empty), the overlay's own window is
  // taken to the middle and made big enough instead, then put back exactly
  // where it was; where it can't be moved, the menu scrolls inside it.
  const rows = 6 + defs.length + (extraRows ?? (extraSettings ? 3 : 0));
  const [popup, setPopup] = useState<Window | null>(null);
  const popupRef = useRef<Window | null>(null);
  const scr = window.screen as Screen & { availLeft?: number; availTop?: number };
  const menuSize = () => ({
    w: Math.min(scr.availWidth - 40, menuWidth + 40),
    h: Math.min(scr.availHeight - 60, 90 + rows * ROW_PX),
  });

  /** The overlay's look carried into the settings window: its styles, theme and fonts. */
  const dressPopup = (w: Window) => {
    const doc = w.document;
    doc.head.querySelectorAll("[data-uc-copied]").forEach((n) => n.remove());
    document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach((n) => {
      const c = n.cloneNode(true) as HTMLElement;
      c.setAttribute("data-uc-copied", "");
      doc.head.appendChild(c);
    });
    const root = document.documentElement;
    doc.documentElement.setAttribute("style", root.getAttribute("style") ?? "");
    for (const a of ["data-hud-theme", "data-hud-light"]) {
      const v = root.getAttribute(a);
      if (v == null) doc.documentElement.removeAttribute(a);
      else doc.documentElement.setAttribute(a, v);
    }
    doc.body.className = styles.popupBody;
  };

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
    if (menu) {
      popupRef.current?.focus();
      return;
    }
    let w: Window | null = null;
    try {
      const { w: mw, h: mh } = menuSize();
      const left = (scr.availLeft ?? 0) + Math.round((scr.availWidth - mw) / 2);
      const top = (scr.availTop ?? 0) + Math.round((scr.availHeight - mh) / 2);
      w = window.open("", `uc-settings-${title.replace(/\W+/g, "-")}`, `popup=yes,width=${mw},height=${mh},left=${left},top=${top}`);
    } catch {
      w = null;
    }
    if (!w || w.closed || !w.document) {
      openInMiddle();
      return;
    }
    try {
      w.document.title = `${title} settings`;
      dressPopup(w);
    } catch {
      // Not ours to draw in: the menu opens in the overlay instead.
      w.close();
      openInMiddle();
      return;
    }
    popupRef.current = w;
    setPopup(w);
    setMenu(true);
    // Closed with its own close button: the menu with it.
    w.addEventListener("pagehide", () => {
      if (popupRef.current !== w) return;
      popupRef.current = null;
      setPopup(null);
      setMenu(false);
    });
    w.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeRef.current();
    });
    // Came up empty (a window Sauce made that we can't draw in): the old way instead.
    setTimeout(() => {
      if (popupRef.current !== w) return;
      let ok = false;
      try {
        ok = !w.closed && !!w.document.body.querySelector('[role="dialog"]');
      } catch {
        ok = false;
      }
      if (ok) return;
      popupRef.current = null;
      setPopup(null);
      try {
        w.close();
      } catch {
        // Gone already.
      }
      openInMiddle();
    }, 600);
  };

  // The theme changed while the settings are open: the settings window follows.
  useEffect(() => {
    if (popup && !popup.closed) dressPopup(popup);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, popup]);

  // The overlay going away takes its settings window with it.
  useEffect(() => () => popupRef.current?.close(), []);

  const closeMenu = () => {
    setMenu(false);
    const w = popupRef.current;
    if (w) {
      popupRef.current = null;
      setPopup(null);
      try {
        w.close();
      } catch {
        // Gone already.
      }
      return;
    }
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
      <div className={styles.grip} title="Drag to move">
        <span>⠿ drag to move</span>
      </div>
      {moving && (
        <div className={styles.moveLayer}>
          <div className={styles.moveCard}>
            Drag anywhere to move this window
            <button type="button" onClick={() => setMoving(false)}>
              Done
            </button>
          </div>
        </div>
      )}
      {children}
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
            <button
              type="button"
              className={styles.moveButton}
              onClick={() => {
                closeMenu();
                setMoving(true);
              }}
            >
              Move this window
            </button>
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
          return popup ? createPortal(<div className={styles.popupMenu}>{content}</div>, popup.document.body) : content;
        })()}
    </div>
  );
}
