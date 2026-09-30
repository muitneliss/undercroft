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
 *   - **which step we are on** is `sendCode.isSuccess` -- a code has been sent, so ask for
 *     it. Not a stored flag that could disagree with whether the send actually happened.
 *   - **the address being verified** is `sendCode.variables.email`. React Query keeps the
 *     variables it was called with; copying them into state would be a second value that
 *     has to be kept in step with the first.
 *   - **pending and failed** are the mutations' own flags, exactly as `Book.tsx` reads
 *     `signOut.isPending`. A sign-in that reloads the page on success counts `isSuccess` as
 *     pending too: the mutation has settled but the browser has not left yet, and a plate
 *     that re-enabled in that gap would invite a second sign-in.
 *   - **going back** is `sendCode.reset()`. One owner, one reset.
 *
 * The two inputs are uncontrolled and read through a `useRef` on submit. A DOM ref is not
 * application state -- ADR 0009 says so -- and it matters here for a second reason: the code
 * is a short-lived secret, and it never enters a store or the URL.
 *
 * So the query cache owns everything, which is what `state.md` asks for: one value, one
 * owner, and nothing to drift.
 *
 * ## Which ways in are shown is the server's answer
 *
 * The local method (`useLocalSignIn`) is shown because the server says it offers it, not because
 * the bundle is a development build: a desktop install runs the production bundle (ADR 0094).
 * Offered alone, there is nothing to ask, and the page signs the owner in by itself.
 */

import { useMutation } from "@tanstack/react-query";
import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  isAuthorizing,
  sendSignInCode,
  signInLocally,
  signInWithCode,
  signInWithGoogle,
} from "@/auth.ts";
import { Colophon } from "@/components/Colophon.tsx";
import { Errata } from "@/components/Errata.tsx";
import { LanguageSwitcher } from "@/components/LanguageSwitcher.tsx";
import { Mark } from "@/components/Mark.tsx";
import { useLocalSignIn } from "@/components/useLocalSignIn.ts";
import { DIVISIONS } from "@/lib/divisions.ts";

/** The full wheel: seven hues, every one of them a division's, in the order they are bound. */
const WHEEL = DIVISIONS.map((d) => d.hue);

export function SignIn({ reason }: { reason?: "expired" | "denied" }): React.JSX.Element {
  const { t } = useTranslation();
  const local = useLocalSignIn();

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
          <span className="imprint__name">{t("app.name")}</span>
        </div>

        {/* The language pair is on the title page too, and it has to be: this is the first
            screen anyone sees, and someone who cannot read it has not signed in yet and so
            has no stored preference for the running head to honour. */}
        <div className="row">
          <LanguageSwitcher />
        </div>

        <div className="stack stack--tight">
          <h1>{t("signIn.title")}</h1>
          <p className="prose prose--lead">{t("signIn.lead")}</p>
        </div>

        {/* A model-context client sent this person here (ADR 0061). The page is the same
            page with the same gates -- invite-only holds -- and says why they are on it. */}
        {isAuthorizing() ? (
          <p className="note" role="status">
            {t("signIn.authorizing")}
          </p>
        ) : null}

        {reason === "expired" ? (
          <p className="note" role="status">
            {t("signIn.expired")}
          </p>
        ) : null}

        {reason === "denied" ? (
          <Errata heading={t("signIn.deniedHeading")} live={true}>
            {t("signIn.denied")}
          </Errata>
        ) : null}

        {local === "automatic" ? (
          <OwnerSignIn />
        ) : (
          <SignInChoices offersLocal={local === "button"} />
        )}

        {/* The imprint opens this page and the colophon closes it, on the same hairline
            rule. It is here rather than only inside the book because the person who most
            needs to name a build is the one who cannot get past this screen. */}
        <Colophon />
      </div>
    </main>
  );
}

/**
 * The ways in the person chooses between: the local method when the server offers it beside
 * the others, Google, and a code by email.
 */
function SignInChoices({ offersLocal }: { offersLocal: boolean }): React.JSX.Element {
  const sendCode = useMutation({
    mutationFn: (variables: { email: string }) => sendSignInCode(variables.email),
  });

  // The step, derived. `variables` is what the send was called with, so the address shown
  // and the address verified cannot disagree.
  const sentTo = sendCode.isSuccess ? sendCode.variables.email : null;

  return (
    <>
      {offersLocal ? <DevSignIn /> : null}

      <GoogleSignIn />

      {/*
       * The two steps are KEYED, and the key is the only reason the step change
       * is visible.
       *
       * Both forms render at the same position, so React reconciles one into the
       * other: same <form> element, new children, no remount -- and the slip-tip
       * in `index.css` cannot run on an element that never arrived. A distinct
       * key per step makes the swap a real mount, which is also the honest shape
       * of it. This is a different form asking a different question, not the
       * first one with its fields rewritten, and the uncontrolled inputs behind
       * it are cleared by the remount rather than by hand.
       */}
      {sentTo === null ? (
        <AddressForm
          key="address"
          pending={sendCode.isPending}
          error={sendCode.isError ? sendCode.error : null}
          onSend={(email): void => {
            sendCode.mutate({ email });
          }}
        />
      ) : (
        <CodeForm
          key="code"
          sentTo={sentTo}
          onUseAnotherAddress={(): void => {
            sendCode.reset();
          }}
        />
      )}
    </>
  );
}

/**
 * A desktop install's way in (ADR 0094). The local method is the only one the server offers, so
 * there is no choice to put to the person: the page makes the call itself, once, on arrival, and
 * the session it gets is the same ordinary one `DevSignIn` would have got with a click.
 *
 * ONCE is a latch, as in `LakeAnswers`: StrictMode mounts, tears down and mounts again, and the
 * second pass of the effect still sees the render in which the mutation was idle -- so without
 * the ref a development build would sign in twice, two sessions, where a production one signs in
 * once.
 *
 * A refusal stays on screen with the server's reason and a retry rather than trying again by
 * itself. The refusal worth expecting is a configuration only the person can fix -- the address
 * is not a superadmin -- and asking again in a loop would only repeat it.
 */
function OwnerSignIn(): React.JSX.Element {
  const { t } = useTranslation();
  const signIn = useMutation({
    mutationFn: signInLocally,
    onSuccess: (destination) => {
      // A full reload, as after a code: the identity just changed under every cached query.
      globalThis.location.assign(destination);
    },
  });
  const askedRef = useRef(false);
  const { mutate } = signIn;

  useEffect(() => {
    if (!askedRef.current) {
      askedRef.current = true;
      mutate();
    }
  }, [mutate]);

  if (signIn.isError) {
    return (
      <div className="stack stack--tight">
        <Errata heading={t("signIn.notSignedIn")} live={true}>
          {signIn.error.message}
        </Errata>
        <div className="row">
          <button
            className="plate plate--primary"
            type="button"
            onClick={(): void => {
              signIn.mutate();
            }}
          >
            {t("signIn.retry")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <p className="note" role="status">
      {t("signIn.signingInOwner")}
    </p>
  );
}

/**
 * Google's way in. The server answers with Google's address and the browser follows it, so the
 * plate stays pending through the answer AND the navigation -- there is no later moment on this
 * page at which the sign-in is over.
 */
function GoogleSignIn(): React.JSX.Element {
  const { t } = useTranslation();
  const signIn = useMutation({ mutationFn: signInWithGoogle });
  const leaving = signIn.isPending || signIn.isSuccess;

  return (
    <div className="stack stack--tight">
      <div className="row">
        <button
          className="plate plate--primary"
          type="button"
          disabled={leaving}
          onClick={(): void => {
            signIn.mutate();
          }}
        >
          {leaving ? t("signIn.openingGoogle") : t("signIn.google")}
        </button>
      </div>
      {signIn.isError ? (
        <Errata heading={t("signIn.notSignedIn")} live={true}>
          {signIn.error.message}
        </Errata>
      ) : null}
    </div>
  );
}

/**
 * The local method as a button, `POST /api/auth/sign-in/dev`, shown when the server offers it
 * beside a method that proves something: one click, and the session is an ordinary Better Auth
 * session for the address the control plane was started with. The server has the method only
 * on loopback with `UNDERCROFT_DEV_SIGN_IN_AS` set, and says so here only when it has it.
 */
function DevSignIn(): React.JSX.Element {
  const { t } = useTranslation();
  const signIn = useMutation({
    mutationFn: signInLocally,
    onSuccess: (destination) => {
      // A full reload, as after a code: the identity just changed under every cached query.
      globalThis.location.assign(destination);
    },
  });
  const leaving = signIn.isPending || signIn.isSuccess;

  return (
    <div className="stack stack--tight">
      <div className="row">
        <button
          className="plate plate--primary"
          type="button"
          disabled={leaving}
          onClick={(): void => {
            signIn.mutate();
          }}
        >
          {leaving ? t("signIn.signingIn") : t("signIn.dev")}
        </button>
      </div>
      {signIn.isError ? (
        <Errata heading={t("signIn.notSignedIn")} live={true}>
          {signIn.error.message}
        </Errata>
      ) : null}
    </div>
  );
}

/**
 * Step one: which address. The input is uncontrolled and read on submit, so the value lives
 * in the DOM and nowhere else -- see the note at the top of this file.
 */
function AddressForm({
  onSend,
  pending,
  error,
}: {
  onSend: (email: string) => void;
  pending: boolean;
  error: Error | null;
}): React.JSX.Element {
  const { t } = useTranslation();
  const signinEmailId = useId();
  const emailFieldRef = useRef<HTMLInputElement>(null);

  return (
    <form
      className="stack stack--tight"
      onSubmit={(event): void => {
        event.preventDefault();
        const email = emailFieldRef.current?.value.trim() ?? "";
        if (email !== "") {
          onSend(email);
        }
      }}
    >
      <div className="field">
        <label className="label" htmlFor={signinEmailId}>
          {t("signIn.emailLabel")}
        </label>
        <input
          className="input"
          id={signinEmailId}
          name="email"
          type="email"
          autoComplete="email"
          required={true}
          placeholder={t("signIn.emailPlaceholder")}
          ref={emailFieldRef}
          disabled={pending}
        />
      </div>

      {error === null ? null : (
        <Errata heading={t("signIn.notSent")} live={true}>
          {error.message}
        </Errata>
      )}

      <div className="row">
        <button className="plate" type="submit" disabled={pending}>
          {pending ? t("signIn.sending") : t("signIn.sendCode")}
        </button>
      </div>
    </form>
  );
}

/**
 * Step two: the code that was sent to `sentTo`.
 *
 * The sign-in mutation lives here rather than one level up because it is this step's, and
 * the keyed remount then clears a failed attempt along with the field it was typed into.
 * The code is a short-lived secret: it is read from a ref on submit and never stored.
 */
function CodeForm({
  sentTo,
  onUseAnotherAddress,
}: {
  sentTo: string;
  onUseAnotherAddress: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const signinCodeId = useId();
  const codeFieldRef = useRef<HTMLInputElement>(null);

  const signIn = useMutation({
    mutationFn: (variables: { email: string; otp: string }) =>
      signInWithCode(variables.email, variables.otp),
    onSuccess: (destination) => {
      // A full reload rather than a route change: the identity just changed, and every
      // cached query was answered for the previous one. The same idiom as signing out. Mid-
      // authorization the destination is the consent step rather than the book.
      globalThis.location.assign(destination);
    },
  });
  const leaving = signIn.isPending || signIn.isSuccess;

  return (
    <form
      className="stack stack--tight"
      onSubmit={(event): void => {
        event.preventDefault();
        const otp = codeFieldRef.current?.value.trim() ?? "";
        if (otp !== "") {
          signIn.mutate({ email: sentTo, otp });
        }
      }}
    >
      <div className="field">
        <label className="label" htmlFor={signinCodeId}>
          {t("signIn.codeLabel")}
        </label>
        <input
          className="input"
          id={signinCodeId}
          name="otp"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          required={true}
          maxLength={6}
          placeholder="000000"
          ref={codeFieldRef}
          disabled={leaving}
        />
        {/*
         * Honest on purpose. The server will not say whether an address has access,
         * because that would make this form a list of who does -- so this cannot
         * promise that a code actually went out.
         */}
        <p className="field__hint">{t("signIn.codeHint", { email: sentTo })}</p>
      </div>

      {signIn.isError ? (
        <Errata heading={t("signIn.notSignedIn")} live={true}>
          {signIn.error.message}
        </Errata>
      ) : null}

      <div className="row">
        <button className="plate plate--primary" type="submit" disabled={leaving}>
          {leaving ? t("signIn.signingIn") : t("signIn.signIn")}
        </button>
        <button className="plate plate--small" type="button" onClick={onUseAnotherAddress}>
          {t("signIn.useAnotherAddress")}
        </button>
      </div>
    </form>
  );
}
