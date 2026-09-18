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

// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: These are the functions that hold one decision each -- the connector page loop, the deploy poller, the grant migration -- and the way to shorten them is to split one sequential procedure across several names, which makes the order it happens in harder to follow rather than easier.
// biome-ignore-all lint/correctness/useSingleJsDocAsterisk: Bullet lists inside module docstrings. Biome's fix flattens them, which destroyed the list recording how invite-only is enforced in three independent places -- exactly the documentation that must not be damaged by a formatter.
// biome-ignore-all lint/correctness/useUniqueElementIds: Static ids on the two single-instance forms in the app -- a sign-in panel and an invite form, neither of which can appear twice on a page. The id is what the <label> points at.
// biome-ignore-all lint/nursery/noInlineStyles: Every one of these is data becoming a style: the tab rail's flexGrow IS the division's extent, the skeleton's width varies per row, the colour wheel paints each swatch its own hue. Biome's fix deletes the attribute rather than relocating it, which removes the feature.
// biome-ignore-all lint/nursery/useExplicitType: The 50 sites whose type the compiler could print are annotated. What is left is parameters of callbacks passed to third-party APIs -- Better Auth's hooks, tRPC's builders -- where the type is supplied contextually and writing it out means naming a library-internal type that will drift on the next upgrade.
// biome-ignore-all lint/nursery/useReactNamingConvention: Fires on props named for the domain rather than for React's conventions. The domain names are the ones the design documents use.
// biome-ignore-all lint/performance/noJsxPropsBind: Inline handlers on components that render a handful of rows. The re-render the rule is about matters under a memoised list of hundreds; these lists are bounded by how many connections a tenant has.
// biome-ignore-all lint/style/noJsxLiterals: This would move all 77 pieces of UI copy into constants declared away from the markup that gives them meaning. That trade is worth making when a translation layer needs a key for every string; this app has none, so it buys nothing and costs the ability to read a component and see what it says.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useGlobalThis: Reading `process` in a composition root on Bun, where it is the documented global.

// biome-ignore-all lint/nursery/noReactNativeRawText: React Native rule: it requires text to sit inside a <Text> component, because RN has no text nodes. This is a web React app rendering to the DOM, where a string inside a <p> is exactly right. On under reactNative: all in biome.jsonc, suppressed where it does not apply.

// biome-ignore-all lint/correctness/noSolidDestructuredProps: Solid-domain rule: destructuring props defeats Solid's reactivity, because there `props` is a proxy. React props are a plain object and destructuring them is the idiomatic form.
// biome-ignore-all lint/performance/useSolidForComponent: Solid-domain rule: it wants Solid's `<For>`, which does not exist in React. `Array#map` is how React renders a list.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for this rule makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off globally.

import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";
import { sendSignInCode, signInWithCode, signInWithGoogle } from "@/auth.ts";
import { Errata } from "@/components/Errata.tsx";
import { Mark } from "@/components/Mark.tsx";
import { DIVISIONS } from "@/lib/divisions.ts";

/** The full wheel, including the three hues no division has claimed yet. */
const WHEEL = [...DIVISIONS.map((d) => d.hue), "#3e782b", "#634cb0", "#7f4023"];

export function SignIn({ reason }: { reason?: "expired" | "denied" }): React.JSX.Element {
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
          <Errata heading="No access" live={true}>
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
            onSubmit={(event): void => {
              event.preventDefault();
              const email = emailField.current?.value.trim() ?? "";
              if (email !== "") {
                sendCode.mutate({ email });
              }
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
                required={true}
                placeholder="you@example.com"
                ref={emailField}
                disabled={sendCode.isPending}
              />
            </div>

            {sendCode.isError ? (
              <Errata heading="Not sent" live={true}>
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
            onSubmit={(event): void => {
              event.preventDefault();
              const otp = codeField.current?.value.trim() ?? "";
              if (otp !== "") {
                signIn.mutate({ email: sentTo, otp });
              }
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
                required={true}
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
              <Errata heading="Not signed in" live={true}>
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
                onClick={(): void => {
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
