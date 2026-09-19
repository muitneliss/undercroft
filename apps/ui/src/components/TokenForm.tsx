/**
 * Paste a private-app token, for a source that has no consent screen to send the browser to.
 *
 * The token is read off an uncontrolled `type="password"` input on submit and goes to the
 * server once; it never enters the store, the URL or the query cache. The server hands it to
 * the worker to be PROVEN against the provider before it is sealed, so a refusal here is
 * worded for the person who pasted it: the token is wrong, not the platform. On success the
 * grants list is invalidated and the card that held this form re-renders as connected, which
 * is what removes the form.
 *
 * Its own component rather than JSX inside the card, so `ConnectionCard` stays renderable
 * with no tRPC provider: the card decides WHEN a token form is offered and is handed this
 * as a slot.
 */

// biome-ignore-all lint/correctness/noSolidDestructuredProps: Solid-domain rule: destructuring props defeats Solid's reactivity, because there `props` is a proxy. React props are a plain object and destructuring them is the idiomatic form.
// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as the routes: what remains are contextually-typed callbacks whose inferred type is a React or tRPC shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- React's event handlers, tRPC's builders -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/nursery/useReactNamingConvention: Fires on the `tokenField` handle, which it wants suffixed `Ref`. It is named for what it holds, which is how the form reads, and the convention this follows is DisplayNameForm's beside it.
// biome-ignore-all lint/performance/noJsxPropsBind: An inline submit handler on a single form. The re-render the rule is about matters under a memoised list of hundreds; this is one <form>.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for it makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off.

import { useRef } from "react";
import { useTranslation } from "react-i18next";

import type { Source } from "@/api/types.ts";
import { Errata } from "@/components/Errata.tsx";
import { trpc } from "@/trpc.ts";

export function TokenForm({
  tenantId,
  source,
}: {
  tenantId: string;
  source: Source;
}): React.JSX.Element {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const tokenField = useRef<HTMLInputElement>(null);
  const fieldId = `token-${source}`;

  const setToken = trpc.connections.setToken.useMutation({
    onSuccess: async () => {
      await utils.connections.list.invalidate({ tenantId });
    },
  });

  return (
    <form
      className="stack stack--tight"
      onSubmit={(event) => {
        event.preventDefault();
        const token = tokenField.current?.value.trim() ?? "";
        if (token === "") {
          return;
        }
        setToken.mutate({ tenantId, source, token });
      }}
    >
      <div className="field">
        <label className="label" htmlFor={fieldId}>
          {t("grant.tokenLabel")}
        </label>
        <input
          autoComplete="off"
          className="input"
          disabled={setToken.isPending}
          id={fieldId}
          name="token"
          ref={tokenField}
          required={true}
          type="password"
        />
        <p className="field__hint">{t("grant.tokenHint")}</p>
      </div>

      {setToken.isError ? (
        <Errata heading={t("grant.tokenRejected")} live={true}>
          {setToken.error.message}
        </Errata>
      ) : null}

      <div className="row">
        <button className="plate plate--primary" disabled={setToken.isPending} type="submit">
          {setToken.isPending ? t("grant.tokenSaving") : t("grant.tokenSave")}
        </button>
      </div>
    </form>
  );
}
