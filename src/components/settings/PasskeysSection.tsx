import { useEffect, useState } from "react";
import { deletePasskey, listPasskeys, passkeysSupported, registerPasskey, type PasskeySummary } from "../../utils/passkeys";
import styles from "./PasskeysSection.module.css";

const PASSKEY_ONLY = import.meta.env.VITE_PASSKEY_ONLY === "true";

function formatDate(iso?: string): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Enrol and manage the passkeys that sign in to this dashboard.
 *
 * Deliberately blunt about device count: with Microsoft sign-in switched off,
 * the passkeys listed here are the only ways in, and one registered device is
 * one device away from being locked out.
 */
export default function PasskeysSection() {
  const [passkeys, setPasskeys] = useState<PasskeySummary[] | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const refresh = () => listPasskeys().then(setPasskeys).catch(() => setPasskeys([]));

  useEffect(() => {
    refresh();
  }, []);

  const handleRegister = async () => {
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      await registerPasskey(label || deviceGuess());
      setLabel("");
      setDone("Passkey registered.");
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not register that passkey.";
      setError(/abort|cancel|NotAllowed/i.test(message) ? null : message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string, deviceLabel: string) => {
    setError(null);
    setDone(null);
    if (!window.confirm(`Remove "${deviceLabel}"? That device will no longer be able to sign in.`)) return;
    try {
      await deletePasskey(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove that passkey.");
    }
  };

  if (!passkeysSupported()) {
    return <p className={styles.hint}>This browser doesn't support passkeys, so none can be registered from here.</p>;
  }

  const count = passkeys?.length ?? 0;

  return (
    <div className={styles.wrap}>
      {passkeys != null && count === 0 && (
        <p className={styles.warn}>
          No passkeys registered yet. Register one on this device before turning off Microsoft sign-in.
        </p>
      )}
      {passkeys != null && count === 1 && PASSKEY_ONLY && (
        <p className={styles.warn}>
          Only one passkey is registered and it's the only way into this dashboard. Add a second device - losing this one
          would lock you out for good.
        </p>
      )}

      {passkeys != null && count > 0 && (
        <ul className={styles.list}>
          {passkeys.map((p) => (
            <li key={p.id} className={styles.item}>
              <span className={styles.itemMain}>
                <span className={styles.itemLabel}>{p.label}</span>
                <span className={styles.itemMeta}>
                  added {formatDate(p.createdAt)} · last used {formatDate(p.lastUsedAt)}
                </span>
              </span>
              <button type="button" className={styles.remove} onClick={() => handleDelete(p.id, p.label)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.addRow}>
        <input
          type="text"
          className={styles.input}
          placeholder={deviceGuess()}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          aria-label="Name for this device"
        />
        <button type="button" className={styles.addButton} onClick={handleRegister} disabled={busy}>
          {busy ? "Waiting for your device…" : "Register a passkey"}
        </button>
      </div>

      {error && <p className={styles.fail}>{error}</p>}
      {done && <p className={styles.ok}>{done}</p>}
    </div>
  );
}

// A name is only there to tell devices apart later, so a rough guess beats
// making it a required field.
function deviceGuess(): string {
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android phone";
  if (/Mac OS X/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows PC";
  return "This device";
}
