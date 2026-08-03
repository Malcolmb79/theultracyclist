import { useState } from "react";
import { passkeysSupported, signInWithPasskey } from "../../utils/passkeys";
import styles from "./SignInGate.module.css";

/**
 * Shown when a signed-in session reaches the coaching side without a passkey
 * behind it.
 *
 * Deliberately not the sign-in gate. The session is valid and the rest of the
 * dashboard is working - being told to "sign in" while demonstrably signed in
 * reads as a bug, and signing out to sign back in would lose the session
 * rather than raise it. This asks for the one thing that's missing.
 *
 * Verifying reuses the ordinary passkey sign-in, which re-issues the session
 * cookie tagged as passkey-authenticated (see api/passkeys.ts). So the effect
 * of stepping up is simply a better session, in place.
 */
export default function PasskeyStepUp({ title }: { title: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const verify = async () => {
    setError(null);
    setBusy(true);
    try {
      await signInWithPasskey();
      // Full reload rather than client state: the session is a cookie and
      // every data hook reads it on mount.
      window.location.reload();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Passkey check failed.";
      // A cancelled prompt throws too, and isn't worth an alarming message.
      setError(/abort|cancel|NotAllowed/i.test(message) ? null : message);
      setBusy(false);
    }
  };

  return (
    <div className={styles.gate}>
      <div className={styles.gateBox}>
        <h1 className={styles.gateTitle}>{title}</h1>
        <p className={styles.stepUpBody}>
          Coaching holds your training notes and the assistant that reads your whole history, so it asks for your
          passkey even when you&apos;re already signed in.
        </p>
        {passkeysSupported() ? (
          <button type="button" className={styles.signInButton} onClick={verify} disabled={busy}>
            {busy ? "Waiting for your device…" : "Verify with a passkey"}
          </button>
        ) : (
          <p className={styles.gateError}>
            This browser doesn&apos;t support passkeys. Open the coaching page on a device that does.
          </p>
        )}
        {error && <p className={styles.gateError}>{error}</p>}
      </div>
    </div>
  );
}
