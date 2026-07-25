import { useEffect, useState } from "react";

export type AuthState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; email: string };

export function useAuthSession(): AuthState {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth-session")
      .then((res) => res.json())
      .then((body: { authenticated: boolean; email?: string }) => {
        if (cancelled) return;
        setState(
          body.authenticated && body.email ? { status: "signed-in", email: body.email } : { status: "signed-out" },
        );
      })
      .catch(() => {
        if (!cancelled) setState({ status: "signed-out" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
