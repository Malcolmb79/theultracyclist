import { useEffect, useState } from "react";
import type { NarrativeInput } from "./types";
import styles from "./AINarrativeCard.module.css";

interface AINarrativeCardProps {
  input: NarrativeInput;
}

type NarrativeState =
  | { status: "loading" }
  | { status: "unconfigured" }
  | { status: "ready"; text: string }
  | { status: "error" };

export default function AINarrativeCard({ input }: AINarrativeCardProps) {
  const [state, setState] = useState<NarrativeState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    fetch("/api/coaching-narrative", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
      .then((res) => res.json())
      .then((body: { configured: boolean; text?: string }) => {
        if (cancelled) return;
        if (!body.configured) {
          setState({ status: "unconfigured" });
        } else {
          setState({ status: "ready", text: body.text ?? "" });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
    // Re-fetch only when the underlying stats actually change, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(input)]);

  return (
    <div className={styles.card}>
      <span className={styles.eyebrow}>Coach's note</span>
      {state.status === "loading" && <p className={styles.muted}>Generating…</p>}
      {state.status === "error" && <p className={styles.muted}>Couldn't generate a note right now.</p>}
      {state.status === "unconfigured" && (
        <p className={styles.muted}>
          Add an <code>ANTHROPIC_API_KEY</code> in Vercel's project environment variables to enable AI-generated
          coaching notes. Everything else on this page works without it.
        </p>
      )}
      {state.status === "ready" && <p className={styles.text}>{state.text}</p>}
    </div>
  );
}
