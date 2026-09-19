/**
 * Choosing what a connected source may read.
 *
 * This screen is the difference between a consent card that tells the truth and one that
 * does not. The card promises "PDFs inside the folders you select. No other folder is read"
 * and "headers and PDF attachments in {{labels}}"; without somewhere to make that selection,
 * connecting Gmail would read an entire mailbox while the screen claimed otherwise.
 *
 * THE TWO SOURCES CHOOSE DIFFERENTLY, AND FOR A REASON WORTH KNOWING.
 *
 * **Gmail** is a list of labels, fetched through the worker because it needs a live token.
 * Choosing none is a *recorded decision* meaning the whole mailbox -- not an empty one --
 * which is why the server refuses a connection with no row at all rather than defaulting it.
 *
 * **Drive** is Google's own Picker, running in the browser. Under the `drive.file` scope a
 * server-side folder listing is not merely unnecessary, it is impossible: the credential
 * cannot see anything that has not been picked. That is the point -- Google enforces the
 * promise instead of our query filter, and the scope needs no annual CASA assessment.
 *
 * `useState` is banned, so the in-progress selection lives in the Zustand store: a draft the
 * user has made and no endpoint knows about is exactly what the store is for.
 *
 * ## The labels are an INDEX, not a list
 *
 * A mailbox with sixty labels, set as one column of stacked checkboxes, is not a long screen
 * -- it is a broken one: the fieldset grew without limit, pushed SAVE past the fold, and left
 * two thirds of the leaf blank beside it. A reference manual does not set an index that way.
 * It sets it in columns, bounded by the height of the leaf it is printed on, with a running
 * head over each continued column, and it puts the entries somebody came to look up first.
 * `@/lib/labelIndex` decides the runs and their order; this file gives them their words.
 *
 * ## What will be read is said WHILE it is being chosen
 *
 * "Choosing no label means the whole mailbox" is printed above the list, and a hint above a
 * long list is read once and then scrolled away from. So the consequence also stands beneath
 * the control, as a line that changes as the ticks change, in the consent card's own
 * sentence -- what an admin reads while choosing is verbatim what the record says
 * afterwards. It carries `role="status"`, so a screen reader is told the same thing at the
 * same moment instead of being left to infer it from a checkbox.
 */

import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { Source } from "@/api/types.ts";
import { SOURCE_LABEL } from "@/api/types.ts";
import { Errata } from "@/components/Errata.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";
import { DriveScope, GmailScope, SaveScope, ScopeLead } from "./scopeFields.tsx";
import { selectionOf, useSaveScope, useStoredDraft } from "./scopeState.ts";

/**
 * The two states in which there is nothing to pick yet: still loading, or the grants could
 * not be read. Returns what to render instead, or null to carry on.
 */
function scopeGuard(
  t: TFunction,
  q: {
    connections: { isPending: boolean; isError: boolean };
    labels: { isPending: boolean };
    source: Source;
    tenantId: string;
  },
): React.JSX.Element | null {
  if (q.connections.isPending || (q.source === "gmail" && q.labels.isPending)) {
    return <Skeleton rows={4} />;
  }
  if (q.connections.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("sources.notLoaded", { tenantId: q.tenantId })}
      </Errata>
    );
  }
  return null;
}

export function ScopePicker({
  tenantId,
  source,
}: {
  tenantId: string;
  source: Source;
}): React.JSX.Element {
  const { t } = useTranslation();

  const draft = useUiStore((s) => s.scopeDraft);
  const setDraft = useUiStore((s) => s.setScopeDraft);
  const clearLabels = useUiStore((s) => s.clearScopeLabels);

  const connections = trpc.connections.list.useQuery({ tenantId });
  const labels = trpc.connections.browseScope.useQuery(
    { tenantId, source },
    // Drive has no server-side listing to fetch; asking for one would be a guaranteed 400.
    { enabled: source === "gmail" },
  );
  const config = trpc.config.google.useQuery(undefined, { enabled: source === "drive" });

  const setScope = useSaveScope(tenantId);

  useStoredDraft(source, connections.data, setDraft);

  const blocked = scopeGuard(t, { connections, labels, source, tenantId });
  if (blocked !== null) {
    return blocked;
  }

  const chosenLabels = draft?.source === source ? draft.labels : [];
  const chosenFiles = draft?.source === source ? draft.files : [];

  function save(): void {
    setScope.mutate({
      tenantId,
      source,
      selection: selectionOf(source, chosenLabels, chosenFiles, labels.data?.items ?? []),
    });
  }

  return (
    <div className="sheet">
      <div className="head head--division">{t("nav.sources")}</div>
      <ScopeLead source={source} />

      <div className="band-rule" />

      <div className="head">{SOURCE_LABEL[source]}</div>
      <div className="body stack">
        {source === "gmail" ? (
          <GmailScope
            source={source}
            items={labels.data?.items ?? []}
            loadError={labels.isError ? labels.error.message : null}
            chosenLabels={chosenLabels}
            clearLabels={clearLabels}
          />
        ) : (
          <DriveScope
            source={source}
            picker={config.data}
            pickerUnavailable={config.isError}
            chosenFiles={chosenFiles}
            setDraft={setDraft}
          />
        )}

        <SaveScope setScope={setScope} onSave={save} />
      </div>
    </div>
  );
}
