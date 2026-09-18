/**
 * Sign in: the manual's title page.
 *
 * No tab rail, because you are not in a section yet. One leaf, the title, and the seven-hue
 * wheel printed down the fore edge as the contents of the book about to be opened -- which
 * is also the first time an operator meets the colour system they will navigate by.
 *
 * ## This form holds no state, and that is not an evasion of the `useState` ban
 *
 * `useState` is banned in `apps/ui/**` and a future reader will reach for it here first, so
 * the reasoning is written down. Everything this form appears to "remember" is DERIVED from
 * the one mutation that already knows it:
 *
 *   * **which step we are on** is `sendCode.isSuccess` -- a code has been sent, so ask for
 *     it. Not a stored flag that could disagree with whether the send actually happened.
 *   * **the address being verified** is `sendCode.variables.email`. React Query keeps the
 *     variables it was called with; copying them into state would be a second value that
 *     has to be kept in step with the first.
 *   * **pending and failed** are the mutations' own flags, exactly as `Book.tsx` reads
 *     `signOut.isPending`.
 *   * **going back** is `sendCode.reset()`. One owner, one reset.
 *
 * The two inputs are uncontrolled and read through a `useRef` on submit. A DOM ref is not
 * application state -- ADR 0009 says so -- and it matters here for a second reason: the code
 * is a short-lived secret, and it never enters a store or the URL.
 *
 * So the query cache owns everything, which is what `state.md` asks for: one value, one
 * owner, and nothing to drift.
 */

import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";
import { sendSignInCode, signInWithCode, signInWithGoogle } from "@/auth";
import { Errata } from "@/components/Errata";
import { Mark } from "@/components/Mark";
import { DIVISIONS } from "@/lib/divisions";

/** The full wheel, including the three hues no division has claimed yet. */
const WHEEL = [...DIVISIONS.map((d) => d.hue), "#3e782b", "#634cb0", "#7f4023"];

export function SignIn({ reason }: { reason?: "expired" | "denied" }) {
  const emailField = useRef<HTMLInputElement>(null);
  const codeField = useRef<HTMLInputElement>(null);

  const sendCode = useMutation({
    mutationFn: (variables: { email: string }) => sendSignInCode(variables.email),
  });

  const signIn = useMutation({
    mutationFn: (variables: { email: string; otp: string }) =>
      signInWithCode(variables.email, variables.otp),
    onSuccess: () => {
      // A full reload rather than a route change: the identity just changed, and every
      // cached query was answered for the previous one. The same idiom as signing out.
      window.location.assign("/");
    },
  });

  // The step, derived. `variables` is what the send was called with, so the address shown
  // and the address verified cannot disagree.
  const sentTo = sendCode.isSuccess ? sendCode.variables.email : null;

  return (
    <main className="titlepage">
      <div className="titlepage__leaf stack">
        <div className="titlepage__wheel" aria-hidden="true">
          {WHEEL.map((hue) => (
            <span key={hue} style={{ background: hue }} />
          ))}
        </div>

        <div className="imprint">
          <Mark size={26} />
          <span className="imprint__name">Undercroft</span>
        </div>

        <div className="stack stack--tight">
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
          <button className="plate plate--primary" type="button" onClick={signInWithGoogle}>
            Continue with Google
          </button>
        </div>

        {sentTo === null ? (
          <form
            className="stack stack--tight"
            onSubmit={(event) => {
              event.preventDefault();
              const email = emailField.current?.value.trim() ?? "";
              if (email !== "") sendCode.mutate({ email });
            }}
          >
            <div className="field">
              <label className="label" htmlFor="signin-email">
                Or sign in with a code
              </label>
              <input
                className="input"
                id="signin-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
                ref={emailField}
                disabled={sendCode.isPending}
              />
            </div>

            {sendCode.isError ? (
              <Errata heading="Not sent" live>
                {sendCode.error.message}
              </Errata>
            ) : null}

            <div className="row">
              <button className="plate" type="submit" disabled={sendCode.isPending}>
                {sendCode.isPending ? "Sending…" : "Email me a code"}
              </button>
            </div>
          </form>
        ) : (
          <form
            className="stack stack--tight"
            onSubmit={(event) => {
              event.preventDefault();
              const otp = codeField.current?.value.trim() ?? "";
              if (otp !== "") signIn.mutate({ email: sentTo, otp });
            }}
          >
            <div className="field">
              <label className="label" htmlFor="signin-code">
                Six-digit code
              </label>
              <input
                className="input"
                id="signin-code"
                name="otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                maxLength={6}
                placeholder="000000"
                ref={codeField}
                disabled={signIn.isPending}
              />
              {/*
               * Honest on purpose. The server will not say whether an address has access,
               * because that would make this form a list of who does -- so this cannot
               * promise that a code actually went out.
               */}
              <p className="field__hint">
                If {sentTo} has access, a code is on its way. It expires in ten minutes.
              </p>
            </div>

            {signIn.isError ? (
              <Errata heading="Not signed in" live>
                {signIn.error.message}
              </Errata>
            ) : null}

            <div className="row">
              <button className="plate plate--primary" type="submit" disabled={signIn.isPending}>
                {signIn.isPending ? "Signing in…" : "Sign in"}
              </button>
              <button
                className="plate plate--small"
                type="button"
                onClick={() => {
                  sendCode.reset();
                }}
              >
                Use a different address
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
