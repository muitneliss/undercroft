/**
 * Publishing the catalogue's draft, asked twice. ADR 0085.
 *
 * A publish is the one action on this page that costs: every readable document goes to the
 * classifier again, billed to the platform's key. So the first press only arms it, and the
 * plate it arms says HOW MANY documents the second press will send -- the figure the server
 * returned with the catalogue (`readableDocuments`), not an estimate made here. Which tenant is
 * armed is the store's (`kindsPublishArmed`), so an arming never survives into another customer.
 *
 * With no difference between the draft and the version in use there is nothing to publish, and
 * the plate is not offered: the server would answer with the same version, and a press that
 * changes nothing should not look like one that does.
 */

import { useTranslation } from "react-i18next";

import { Errata } from "@/components/Errata.tsx";
import { useUiStore } from "@/store.ts";
import type { trpc } from "@/trpc.ts";

export function KindPublish({
  tenantId,
  unpublishedChanges,
  readableDocuments,
  publish,
}: {
  tenantId: string;
  unpublishedChanges: boolean;
  readableDocuments: number;
  publish: ReturnType<typeof trpc.documentKinds.publish.useMutation>;
}): React.JSX.Element {
  const { t } = useTranslation();
  const armed = useUiStore((state) => state.kindsPublishArmed === tenantId);
  const arm = useUiStore((state) => state.armKindsPublish);
  return (
    <>
      <p className="prose">{t("kinds.publishLead")}</p>
      {unpublishedChanges ? (
        <div className="row">
          {armed ? (
            <>
              <button
                className="plate plate--primary"
                type="button"
                disabled={publish.isPending}
                onClick={(): void => publish.mutate({ tenantId })}
              >
                {publish.isPending
                  ? t("kinds.publishing")
                  : t("kinds.publishConfirm", { count: readableDocuments })}
              </button>
              <button
                className="plate"
                type="button"
                disabled={publish.isPending}
                onClick={(): void => arm(null)}
              >
                {t("kinds.publishCancel")}
              </button>
            </>
          ) : (
            <button
              className="plate plate--primary"
              type="button"
              onClick={(): void => arm(tenantId)}
            >
              {t("kinds.publish")}
            </button>
          )}
        </div>
      ) : (
        <p className="note">{t("kinds.publishNothing")}</p>
      )}
      {publish.isSuccess ? (
        <p className="note" role="status">
          {t("kinds.publishedNow", { version: publish.data.version })}
        </p>
      ) : null}
      {publish.isError ? (
        <Errata heading={t("kinds.notPublished")} live={true} error={publish.error} />
      ) : null}
    </>
  );
}
