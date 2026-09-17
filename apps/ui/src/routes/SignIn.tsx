/**
 * Sign in: the manual's title page.
 *
 * No tab rail, because you are not in a section yet. One leaf, the title, and the seven-hue
 * wheel printed down the fore edge as the contents of the book about to be opened -- which
 * is also the first time an operator meets the colour system they will navigate by.
 *
 * The Google button is DISABLED for now: the control plane's OAuth flow is not wired yet, so
 * an enabled button would lead nowhere. It is shown, not hidden, with a plain note that it
 * is not yet available -- the sign-in shape is already in place, and becomes live the moment
 * the flow exists.
 */

import { Errata } from "@/components/Errata";
import { DIVISIONS } from "@/lib/divisions";

/** The full wheel, including the three hues no division has claimed yet. */
const WHEEL = [...DIVISIONS.map((d) => d.hue), "#3e782b", "#634cb0", "#7f4023"];

export function SignIn({ reason }: { reason?: "expired" | "denied" }) {
  return (
    <main className="titlepage">
      <div className="titlepage__leaf stack">
        <div className="titlepage__wheel" aria-hidden="true">
          {WHEEL.map((hue) => (
            <span key={hue} style={{ background: hue }} />
          ))}
        </div>

        <div className="stack stack--tight">
          <span className="label">Undercroft</span>
          <h1>Control plane</h1>
          <p className="prose prose--lead">Connect your accounts and see what has been synced.</p>
        </div>

        {reason === "expired" ? (
          <p className="note" role="status">
            Your session ended. Sign in again to continue.
          </p>
        ) : null}

        {reason === "denied" ? (
          <Errata heading="No access" live>
            That account does not have access. If you were invited, sign in with the exact address
            the invitation was sent to.
          </Errata>
        ) : null}

        <div className="row">
          <button className="plate plate--primary" type="button" disabled aria-disabled="true">
            Continue with Google
          </button>
        </div>

        <p className="note">
          Sign-in is not available yet — the control plane's OAuth flow is still being wired up.
          This page is the shape it will take.
        </p>
      </div>
    </main>
  );
}
