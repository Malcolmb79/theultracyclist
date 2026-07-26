import { useEffect, useRef, useState } from "react";
import styles from "./ProfileMenu.module.css";

// Replaces the old standalone "Settings" tab + inline "Sign out" link with
// a single profile icon holding both - one less item competing for space
// in the main tab row, and a familiar "account menu" pattern instead of an
// exposed sign-out link sitting next to the page tabs. Fetches its own
// picture independently of whatever data each page already loads (some
// pages, like Settings, don't otherwise fetch coaching-settings at all),
// matching how this project keeps components decoupled from page-specific
// data-loading rather than threading a prop through every caller.
export default function ProfileMenu() {
  const [open, setOpen] = useState(false);
  const [pictureUrl, setPictureUrl] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/coaching-settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { settings?: { profilePictureDataUrl?: string } } | null) => {
        if (!cancelled) setPictureUrl(body?.settings?.profilePictureDataUrl ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", handleOutside);
    return () => document.removeEventListener("pointerdown", handleOutside);
  }, [open]);

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((o) => !o)}
        aria-label="Profile menu"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {pictureUrl ? <img src={pictureUrl} alt="" className={styles.pictureIcon} /> : <ProfileIcon />}
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          <a href="/dashboard/settings" className={styles.menuItem} role="menuitem" onClick={() => setOpen(false)}>
            Settings
          </a>
          <a href="/api/auth-logout" className={styles.menuItem} role="menuitem">
            Sign out
          </a>
        </div>
      )}
    </div>
  );
}

function ProfileIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4.4 3.6-6 8-6s8 1.6 8 6" />
    </svg>
  );
}
