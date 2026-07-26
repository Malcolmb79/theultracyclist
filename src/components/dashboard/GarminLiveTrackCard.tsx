import { useEffect, useState } from "react";
import styles from "./GarminLiveTrackCard.module.css";

type State = { status: "loading" } | { status: "notConfigured" } | { status: "ready"; url: string };

// Embeds the athlete's own public Garmin LiveTrack session page directly,
// rather than extracting position data through Garmin's undocumented
// internal API. That approach was tried first (see git history) and hit a
// real wall: the track-points endpoint sits behind CSRF protection that a
// stateless server proxy can't satisfy - confirmed against a real session,
// requests from an actual browser tab succeed while server-side requests
// with matching cookies/headers still get a 403.
//
// The LiveTrack page itself sends no X-Frame-Options or
// Content-Security-Policy frame-ancestors header, so embedding it directly
// is straightforward - Garmin's own page handles its own live polling and
// rendering, so this gets live updates for free with nothing to break if
// Garmin changes their internal API again.
export default function GarminLiveTrackCard() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/coaching-settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { settings?: { garminLiveTrackUrl?: string } } | null) => {
        if (cancelled) return;
        const url = body?.settings?.garminLiveTrackUrl;
        setState(url ? { status: "ready", url } : { status: "notConfigured" });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "notConfigured" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") return <p className={styles.empty}>Loading…</p>;

  if (state.status === "notConfigured") {
    return <p className={styles.empty}>No LiveTrack URL set - paste one in Settings before starting a session.</p>;
  }

  return (
    <iframe
      src={state.url}
      title="Garmin LiveTrack"
      className={styles.frame}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}
