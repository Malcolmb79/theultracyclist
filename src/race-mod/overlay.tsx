import { useEffect, useState, type ReactNode } from "react";
import styles from "./Overlay.module.css";

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

  useEffect(() => {
    document.documentElement.classList.add(styles.transparent);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
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
