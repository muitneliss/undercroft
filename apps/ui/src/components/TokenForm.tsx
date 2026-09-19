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
      onSubmit={(event): void => {
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
