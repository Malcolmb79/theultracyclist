import { useState } from "react";
import { passkeysSupported, signInWithPasskey } from "../../utils/passkeys";
import styles from "./SignInGate.module.css";

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  denied: "That Microsoft account isn't authorized for this dashboard.",
  failed: "Sign-in failed. Please try again.",
};

// Set at build time from Vercel. When true, Microsoft sign-in is hidden and a
// passkey is the only way in - kept as a flag rather than deleting the OAuth
// route so the changeover can be reversed from the dashboard settings without
// a deploy, and so the first passkey can be enrolled while still signing in
// the old way.
const PASSKEY_ONLY = import.meta.env.VITE_PASSKEY_ONLY === "true";

export default function SignInGate({ title }: { title: string }) {
  const authError = new URLSearchParams(window.location.search).get("auth");
  const [error, setError] = useState<string | null>(authError ? AUTH_ERROR_MESSAGES[authError] ?? null : null);
  const [busy, setBusy] = useState(false);

  const handlePasskey = async () => {
    setError(null);
    setBusy(true);
    try {
      await signInWithPasskey();
      // A full reload rather than client-side state: the session is a cookie,
      // and every data hook reads it on mount.
      window.location.reload();
    } catch (err) {
      // A cancelled prompt throws too - not worth an alarming message.
      const message = err instanceof Error ? err.message : "Passkey sign-in failed.";
      setError(/abort|cancel|NotAllowed/i.test(message) ? null : message);
      setBusy(false);
    }
  };

  return (
    <div className={styles.gate}>
      <div className={styles.gateBox}>
        <h1 className={styles.gateTitle}>{title}</h1>

        {passkeysSupported() && (
          <button type="button" className={styles.signInButton} onClick={handlePasskey} disabled={busy}>
            <PasskeyIcon />
            {busy ? "Waiting for your device…" : "Sign in with a passkey"}
          </button>
        )}

        {!PASSKEY_ONLY && (
          <a className={`${styles.signInButton} ${styles.secondaryButton}`} href="/api/auth-login">
            <MicrosoftLogo />
            Sign in with Microsoft
          </a>
        )}

        {error && <p className={styles.gateError}>{error}</p>}

        {!passkeysSupported() && PASSKEY_ONLY && (
          <p className={styles.gateError}>This browser doesn't support passkeys, and it's the only sign-in method enabled.</p>
        )}
      </div>
    </div>
  );
}

function PasskeyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="9" cy="8" r="4" />
      <path d="M14.5 12.5 21 19v3h-3l-1-1h-2v-2h-1.5l-1-1v-2.5z" />
      <path d="M2 21c0-3.3 3.1-6 7-6" />
    </svg>
  );
}

function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}
