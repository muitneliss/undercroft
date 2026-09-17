/**
 * Sign in.
 *
 * States plainly who may sign in, because the alternative — a Google button and
 * a generic failure — leaves an invited client unable to tell "I used the wrong
 * account" from "this is broken". Sign-in accepts Workspace and personal Google
 * accounts alike; what decides access is staff domain or an invitation.
 */

export function SignIn({ reason }: { reason?: "expired" | "denied" }) {
  return (
    <main className="main" style={{ maxWidth: "34rem", margin: "0 auto", paddingTop: "12vh" }}>
      <div className="panel stack">
        <div>
          <h1>VietCham data platform</h1>
          <p className="page-header__sub">
            Connect your accounts and see what has been synced.
          </p>
        </div>

        {reason === "expired" ? (
          <p className="field__hint" role="status">
            Your session ended. Sign in again to continue.
          </p>
        ) : null}

        {reason === "denied" ? (
          <p className="error-text" role="alert">
            That account does not have access. If you were invited, sign in with the exact
            address the invitation was sent to.
          </p>
        ) : null}

        <a className="btn btn--primary" href="/api/auth/login" style={{ textAlign: "center" }}>
          Continue with Google
        </a>

        <p className="field__hint">
          Works with a Google Workspace account or a personal Google account. Staff sign in
          directly; everyone else needs an invitation.
        </p>
      </div>
    </main>
  );
}
