/**
 * The scope picker's state: what is already stored, what gets saved, and in what shape.
 *
 * Separate from `scopeFields.tsx` because a module that exports components should export
 * only components -- mixing a hook in defeats React Fast Refresh, and the lint rule that
 * says so is right.
 */

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { Source } from "@/api/types.ts";
import { divisionPath } from "@/lib/divisions.ts";
import type { BrowsedLabel } from "@/lib/labelIndex.ts";
import type { ScopeDraft } from "@/store.ts";
import { trpc } from "@/trpc.ts";

/**
 * Seed the draft from what is already stored, once the grants arrive.
 *
 * An admin changing a selection should see what they chose last time, not an empty form that
 * silently means "everything" -- which for Gmail is the whole mailbox.
 */
export function useStoredDraft(
  source: Source,
  connections:
    | readonly { source: string; config: { labels?: string[]; folderIds?: string[] } }[]
    | undefined,
  setDraft: (draft: ScopeDraft) => void,
): void {
  const current = connections?.find((c) => c.source === source);
  useEffect(() => {
    if (current === undefined) {
      return;
    }
    setDraft({
      source,
      labels: current.config.labels ?? [],
      files: (current.config.folderIds ?? []).map((id) => ({ id, name: id, kind: "folder" })),
    });
  }, [current, source, setDraft]);
}
/**
 * Saving a selection, and leaving the page when it lands.
 *
 * `navigate` returns a promise in react-router 7 and nothing here waits on the transition --
 * the component unmounts when it arrives, which is why the result is deliberately voided.
 */
export function useSaveScope(
  tenantId: string,
): ReturnType<typeof trpc.connections.setScope.useMutation> {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  return trpc.connections.setScope.useMutation({
    onSuccess: async () => {
      await utils.connections.list.invalidate({ tenantId });
      void navigate(divisionPath("sources", tenantId));
    },
  });
}
/**
 * What gets saved, in the shape the source's schema expects.
 *
 * A Gmail label is stored as `{ id, name }` and matched back by NAME, because the name is
 * what the admin chose and the id is what the API needs -- an id that no longer resolves
 * falls back to the name rather than silently dropping the label.
 */
export function selectionOf(
  source: Source,
  chosenLabels: readonly string[],
  chosenFiles: ScopeDraft["files"],
  items: readonly BrowsedLabel[],
): { labels: { id: string; name: string }[] } | { files: ScopeDraft["files"] } {
  if (source !== "gmail") {
    return { files: chosenFiles };
  }
  return {
    labels: chosenLabels.map((name) => ({
      id: items.find((i) => i.name === name)?.id ?? name,
      name,
    })),
  };
}
