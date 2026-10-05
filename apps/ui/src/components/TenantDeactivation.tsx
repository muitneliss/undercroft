/**
 * Deactivating a customer, and the page that stands in for its book while it is (ADR 0110).
 *
 * Two components in one module because they are the two halves of one state: `DeactivateTenant`
 * moves a customer into it, `DeactivatedNotice` is what every division shows while it is there and
 * the one way back out. Both invalidate the same two caches, for the reason `DisplayNameForm`
 * does: `tenants.get` is what the book reads its state from, and `tenants.list` marks the row.
 *
 * DEACTIVATE TAKES A SECOND PRESS, behind a fold that says what happens and what does not, the
 * way Disconnect and Remove do (`GrantActions.tsx`, `Roster.tsx`). It takes access from every
 * member, the admin pressing it included, and "nothing is deleted" is the sentence that keeps a
 * person from reading it as a deletion. A fold, never a modal, and no `useState` -- `<details>`
 * holds whether it is open.
 *
 * Hiding either control from a non-admin is courtesy, not the control: `tenants.deactivate` and
 * `tenants.reactivate` are `requireRole("admin")` and refuse whatever the browser rendered.
 */

import { useTranslation } from "react-i18next";

import { Errata } from "@/components/Errata.tsx";
import { formatDateTime } from "@/lib/when.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

/** Both caches that hold a customer's state: the open book's, and the list's row. */
function useInvalidateTenant(tenantId: string): () => Promise<void> {
  const utils = trpc.useUtils();
  return async (): Promise<void> => {
    await utils.tenants.get.invalidate({ tenantId });
    await utils.tenants.list.invalidate();
  };
}

/** The fold at the foot of Sources, under the display name, for an admin. */
export function DeactivateTenant({
  tenantId,
  displayName,
  canEdit,
}: {
  tenantId: string;
  displayName: string;
  canEdit: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const invalidate = useInvalidateTenant(tenantId);
  const deactivate = trpc.tenants.deactivate.useMutation({ onSuccess: invalidate });

  if (!canEdit) {
    return <p className="note">{t("tenants.deactivateNote")}</p>;
  }

  return (
    <>
      <details className="tokenform">
        <summary className="plate">{t("tenants.deactivate")}</summary>
        <div className="hinge stack stack--tight">
          {/* Before the plate, so what the second press does -- and what it leaves alone -- is
              read before it is pressed. */}
          <p className="note">{t("tenants.deactivateLead")}</p>
          <div className="row">
            <button
              className="plate plate--primary"
              type="button"
              disabled={deactivate.isPending}
              onClick={(): void => {
                deactivate.mutate({ tenantId });
              }}
            >
              {deactivate.isPending
                ? t("tenants.deactivating")
                : t("tenants.deactivateConfirm", { name: displayName || tenantId })}
            </button>
          </div>
        </div>
      </details>

      {/* The server's own words: a refusal here names the state the customer is in, which a
          local sentence would have to guess. */}
      {deactivate.isError ? (
        <Errata heading={t("tenants.notDeactivated")} live={true} error={deactivate.error} />
      ) : null}
    </>
  );
}

/**
 * What a deactivated customer's book shows, in place of whichever division was opened.
 *
 * In place of, not above: every division's own procedures are refused while the customer is
 * deactivated, so rendering them would fill the page with errors that each say the same thing
 * less clearly than this does. An admin gets Reactivate; anybody else is told who can.
 */
export function DeactivatedNotice({
  tenantId,
  role,
  deactivatedAt,
}: {
  tenantId: string;
  role: string;
  deactivatedAt: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const invalidate = useInvalidateTenant(tenantId);
  const reactivate = trpc.tenants.reactivate.useMutation({ onSuccess: invalidate });

  return (
    <div className="sheet">
      <div className="body stack">
        <h1>{t("tenants.deactivatedHead")}</h1>
        <p className="prose prose--lead">
          {t("tenants.deactivatedSince", { when: formatDateTime(deactivatedAt, locale) })}
        </p>
        {role === "admin" ? (
          <>
            <p className="prose">{t("tenants.deactivatedAdmin")}</p>
            <div className="row">
              <button
                className="plate plate--primary"
                type="button"
                disabled={reactivate.isPending}
                onClick={(): void => {
                  reactivate.mutate({ tenantId });
                }}
              >
                {reactivate.isPending ? t("tenants.reactivating") : t("tenants.reactivate")}
              </button>
            </div>
            {reactivate.isError ? (
              <Errata heading={t("tenants.notReactivated")} live={true} error={reactivate.error} />
            ) : null}
          </>
        ) : (
          <p className="prose">{t("tenants.deactivatedOthers")}</p>
        )}
      </div>
    </div>
  );
}
