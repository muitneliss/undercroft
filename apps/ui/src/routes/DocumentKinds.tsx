/**
 * The catalogue of document kinds: what every readable document is classified as. ADR 0085.
 *
 * A PAGE OF THE LAKE, NOT A DIVISION. The kinds describe the lake's documents, and an eighth
 * division is a decision about the wheel (`@/lib/divisions`) that a catalogue does not need to
 * make; the lake's index keeps a door to it, as it does to the console.
 *
 * Any member may read it: which kinds exist, where each came from and how much of the sample it
 * was. Only an admin may change it, initialise it or publish it, and the server refuses everyone
 * else regardless -- hiding the controls is the honest rendering of what the reader may do.
 *
 * AN INITIALISE IS A RUN, not an answer. It returns a run id at once and the kinds appear when
 * that run closes, so the list is polled while the page knows one is going and the catalogue is
 * still empty -- and stops the moment either stops being true.
 */

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { EmptyState } from "@/components/EmptyState.tsx";
import { Errata } from "@/components/Errata.tsx";
import { KindAdd } from "@/components/KindAdd.tsx";
import { KindPublish } from "@/components/KindPublish.tsx";
import { KindTable } from "@/components/KindTable.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { formatDateTime } from "@/lib/when.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

/** How often the list is asked again while an initialise run is filling it. */
const INITIALISE_POLL_MS = 5000;

/** The page's writes. Every one refreshes the catalogue, which is the only thing they change. */
function useKindWrites(tenantId: string): {
  add: ReturnType<typeof trpc.documentKinds.add.useMutation>;
  update: ReturnType<typeof trpc.documentKinds.update.useMutation>;
  remove: ReturnType<typeof trpc.documentKinds.remove.useMutation>;
  publish: ReturnType<typeof trpc.documentKinds.publish.useMutation>;
  initialise: ReturnType<typeof trpc.documentKinds.initialise.useMutation>;
} {
  const utils = trpc.useUtils();
  const setKindEditing = useUiStore((state) => state.setKindEditing);
  const armKindsPublish = useUiStore((state) => state.armKindsPublish);
  function refresh(): Promise<void> {
    return utils.documentKinds.list.invalidate({ tenantId });
  }
  return {
    add: trpc.documentKinds.add.useMutation({ onSuccess: refresh }),
    update: trpc.documentKinds.update.useMutation({
      onSuccess: async () => {
        setKindEditing(null);
        await refresh();
      },
    }),
    remove: trpc.documentKinds.remove.useMutation({ onSuccess: refresh }),
    publish: trpc.documentKinds.publish.useMutation({
      onSuccess: async () => {
        armKindsPublish(null);
        await refresh();
      },
    }),
    initialise: trpc.documentKinds.initialise.useMutation(),
  };
}

type KindWritesAll = ReturnType<typeof useKindWrites>;

/** An empty catalogue: what initialising does, and -- for an admin -- the plate that starts it. */
function Uninitialised({
  tenantId,
  isAdmin,
  initialise,
}: {
  tenantId: string;
  isAdmin: boolean;
  initialise: KindWritesAll["initialise"];
}): React.JSX.Element {
  const { t } = useTranslation();
  const action = isAdmin ? (
    <div className="row">
      <button
        className="plate plate--primary"
        type="button"
        disabled={initialise.isPending || initialise.isSuccess}
        onClick={(): void => initialise.mutate({ tenantId })}
      >
        {initialise.isPending ? t("kinds.initialising") : t("kinds.initialise")}
      </button>
    </div>
  ) : (
    <p className="note">{t("kinds.emptyMember", { tenantId })}</p>
  );
  return (
    <>
      <EmptyState title={t("kinds.emptyTitle")} body={t("kinds.emptyBody")} action={action} />
      {initialise.isSuccess ? (
        <div className="row" role="status">
          <p className="note">{t("kinds.initialiseStarted")}</p>
          <Link
            className="plate plate--small"
            to={`/tenants/${tenantId}/journal/${initialise.data.runId}`}
          >
            {t("kinds.initialiseWatch")}
          </Link>
        </div>
      ) : null}
      {initialise.isError ? (
        <Errata heading={t("kinds.notInitialised")} live={true} error={initialise.error} />
      ) : null}
    </>
  );
}

/** Which version is in use, whether the draft differs from it, and what a publish would send. */
function Standing({
  published,
  unpublishedChanges,
  readableDocuments,
}: {
  published: { version: number; publishedAt: string; publishedBy: string } | null;
  unpublishedChanges: boolean;
  readableDocuments: number;
}): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  return (
    <>
      <p className="note">
        {published === null
          ? t("kinds.neverPublished")
          : t("kinds.published", {
              version: published.version,
              when: formatDateTime(published.publishedAt, locale),
              by: published.publishedBy,
            })}
      </p>
      <p className="note">{t("kinds.readable", { count: readableDocuments })}</p>
      {unpublishedChanges && published !== null ? (
        <p className="note">{t("kinds.unpublished")}</p>
      ) : null}
    </>
  );
}

export function DocumentKinds({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const tenant = trpc.tenants.get.useQuery({ tenantId });
  const writes = useKindWrites(tenantId);
  const catalogue = trpc.documentKinds.list.useQuery(
    { tenantId },
    {
      refetchInterval: (query) =>
        writes.initialise.isSuccess && (query.state.data?.kinds.length ?? 0) === 0
          ? INITIALISE_POLL_MS
          : false,
    },
  );

  if (catalogue.isPending || tenant.isPending) {
    return <Skeleton rows={6} />;
  }
  if (catalogue.isError || tenant.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("kinds.notLoaded", { tenantId })}
      </Errata>
    );
  }

  const isAdmin = tenant.data.role === "admin";
  const { kinds, available, published, unpublishedChanges, readableDocuments } = catalogue.data;

  return (
    <div className="sheet">
      <div className="head head--division">{t("kinds.head")}</div>
      <div className="body stack">
        <h1>{t("kinds.title")}</h1>
        <p className="prose prose--lead">{t("kinds.lead", { tenantId })}</p>
        <Standing
          published={published}
          unpublishedChanges={unpublishedChanges}
          readableDocuments={readableDocuments}
        />
        {kinds.length === 0 ? (
          <Uninitialised tenantId={tenantId} isAdmin={isAdmin} initialise={writes.initialise} />
        ) : (
          <KindTable kinds={kinds} tenantId={tenantId} isAdmin={isAdmin} writes={writes} />
        )}
        <div className="row">
          <Link className="plate" to={`/tenants/${tenantId}/lake`}>
            {t("kinds.back")}
          </Link>
        </div>
      </div>

      {isAdmin && kinds.length > 0 ? (
        <>
          <div className="band-rule" />
          <div className="head">{t("kinds.addHead")}</div>
          <div className="body stack">
            <KindAdd available={available} tenantId={tenantId} add={writes.add} />
          </div>

          <div className="band-rule" />
          <div className="head">{t("kinds.publishHead")}</div>
          <div className="body stack">
            <KindPublish
              tenantId={tenantId}
              unpublishedChanges={unpublishedChanges}
              readableDocuments={readableDocuments}
              publish={writes.publish}
            />
          </div>
        </>
      ) : null}

      {!isAdmin && kinds.length > 0 ? (
        <div className="body">
          <p className="note">{t("kinds.adminOnly", { tenantId })}</p>
        </div>
      ) : null}
    </div>
  );
}
