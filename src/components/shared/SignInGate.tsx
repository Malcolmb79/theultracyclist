import styles from "./SignInGate.module.css";

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  denied: "That Microsoft account isn't authorized for this dashboard.",
  failed: "Sign-in failed. Please try again.",
};

export default function SignInGate({ title }: { title: string }) {
  const authError = new URLSearchParams(window.location.search).get("auth");
  const errorMessage = authError ? AUTH_ERROR_MESSAGES[authError] : null;

  return (
    <div className={styles.gate}>
      <div className={styles.gateBox}>
        <h1 className={styles.gateTitle}>{title}</h1>
        <a className={styles.signInButton} href="/api/auth-login">
          <MicrosoftLogo />
          Sign in with Microsoft
        </a>
        {errorMessage && <p className={styles.gateError}>{errorMessage}</p>}
      </div>
    </div>
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
