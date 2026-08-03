import { useEffect, useState } from "react";

export type AuthState =
  | { status: "loading" }
  | { status: "signed-out" }
  // amr is how the session was authenticated. Coaching requires "passkey";
  // everywhere else is content with either.
  | { status: "signed-in"; email: string; amr: "passkey" | "microsoft" };

/**
 * Comfortably inside the server's idle timeout, so an open dashboard is always
 * renewed well before it could lapse - and infrequent enough that a page left
 * up all day is a handful of requests rather than a poll.
 */
const KEEPALIVE_MS = 5 * 60_000;

export function useAuthSession(): AuthState {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    const check = () => {
      fetch("/api/auth-session")
        .then((res) => res.json())
        .then((body: { authenticated: boolean; email?: string; amr?: "passkey" | "microsoft" }) => {
          if (cancelled) return;
          setState(
            body.authenticated && body.email
              ? { status: "signed-in", email: body.email, amr: body.amr ?? "microsoft" }
              : { status: "signed-out" },
          );
        })
        .catch(() => {
          // A failed check is not a signed-out session - it is usually a lost
          // network. Dropping someone to the sign-in gate over a dead tunnel,
          // and then asking for a passkey, is exactly the interruption this is
          // meant to avoid, so only an answered request changes an established
          // state. The first check is different: with nothing to fall back on,
          // signed-out is the safe answer.
          if (!cancelled) setState((current) => (current.status === "loading" ? { status: "signed-out" } : current));
        });
    };

    check();

    // Each check renews the session server-side (see api/auth-session.ts), so
    // this doubles as the keepalive: the dashboard stays signed in while it is
    // being used, and lapses normally once it isn't.
    const interval = setInterval(check, KEEPALIVE_MS);

    // A laptop that has been asleep wakes with a stale idea of its session.
    // Re-checking when the tab becomes visible means the answer is current at
    // the moment it starts mattering, rather than up to five minutes later.
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return state;
}
