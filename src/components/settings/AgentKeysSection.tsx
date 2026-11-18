import { useEffect, useState } from "react";
import styles from "./PasskeysSection.module.css";

interface AgentKey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt?: string;
}

function formatDate(iso?: string): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Read-only keys for an AI agent (api/_lib/agentAccess.ts): it can read the
 * Dashboard, Trends and Coaching data, and change nothing. A key is shown once,
 * when it's made, and works until it's revoked here.
 */
export default function AgentKeysSection() {
  const [keys, setKeys] = useState<AgentKey[] | null>(null);
  const [name, setName] = useState("");
  const [made, setMade] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    fetch("/api/agent-keys")
      .then((r) =>
        r.ok
          ? (r.json() as Promise<{ keys: AgentKey[] }>).then((b) => setKeys(b.keys))
          : r.status === 403
            ? (setError("Sign in with a passkey to manage agent keys."), setKeys([]))
            : setKeys([]),
      )
      .catch(() => setKeys([]));

  useEffect(() => {
    void refresh();
  }, []);

  const make = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await fetch("/api/agent-keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name.trim() || "AI agent" }) });
      const body = (await r.json()) as { key?: string; error?: string };
      if (!r.ok || !body.key) throw new Error(body.error ?? "Couldn't make a key.");
      setMade(body.key);
      setName("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't make a key.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (k: AgentKey) => {
    if (!window.confirm(`Revoke "${k.name}"? The agent using it loses access straight away.`)) return;
    const r = await fetch(`/api/agent-keys?id=${encodeURIComponent(k.id)}`, { method: "DELETE" });
    if (!r.ok) setError("Couldn't revoke that key.");
    await refresh();
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied(null);
    }
  };

  const loginLink = made ? `${window.location.origin}/api/agent-login?key=${encodeURIComponent(made)}` : "";

  return (
    <div className={styles.wrap}>
      {made && (
        <div className={styles.warn}>
          <p>
            <b>Your new key - copy it now, it won't be shown again.</b>
          </p>
          <p>
            <code style={{ wordBreak: "break-all" }}>{made}</code>
          </p>
          <p>
            <button type="button" className={styles.addButton} onClick={() => void copy(made, "key")}>
              {copied === "key" ? "Key copied" : "Copy key"}
            </button>{" "}
            <button type="button" className={styles.addButton} onClick={() => void copy(loginLink, "link")}>
              {copied === "link" ? "Link copied" : "Copy browser sign-in link"}
            </button>
          </p>
          <p>
            For an agent that calls the site: send <code>Authorization: Bearer &lt;key&gt;</code> on GETs to the site's{" "}
            <code>/api/…</code> data. For one that uses a browser: have it open the sign-in link, then read{" "}
            <code>/dashboard</code>, <code>/dashboard/trends</code> and <code>/dashboard/coaching</code>.
          </p>
        </div>
      )}

      {keys != null && keys.length > 0 && (
        <ul className={styles.list}>
          {keys.map((k) => (
            <li key={k.id} className={styles.item}>
              <span className={styles.itemMain}>
                <span className={styles.itemLabel}>{k.name}</span>
                <span className={styles.itemMeta}>
                  made {formatDate(k.createdAt)} · last used {formatDate(k.lastUsedAt)}
                </span>
              </span>
              <button type="button" className={styles.remove} onClick={() => void revoke(k)}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.addRow}>
        <input
          type="text"
          className={styles.input}
          placeholder="Name, e.g. My AI agent"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Name for the agent key"
        />
        <button type="button" className={styles.addButton} onClick={() => void make()} disabled={busy}>
          Make a read-only key
        </button>
      </div>
      {error && <p className={styles.fail}>{error}</p>}
    </div>
  );
}
