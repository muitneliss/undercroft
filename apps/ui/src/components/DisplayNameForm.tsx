/**
 * Correct one customer's display name.
 *
 * Its own component rather than more JSX inside `TenantOverview`, for two reasons that point
 * the same way: that route is the *sources* division and a naming form is not a source, and
 * folding this into it pushed the route past Biome's cognitive-complexity threshold. The
 * extraction is the fix the linter was asking for, not a suppression of it.
 *
 * What it deliberately cannot do is change the tenant id. `tenants.rename` takes no id in its
 * body at all -- the id is an object-key prefix in the create-only raw lake, so a "rename"
 * would strand every byte already written under the old prefix. Leaving it out of the input
 * makes that impossible to ask for rather than merely refused, and this form has one field
 * because the procedure has one field.
 *
 * `canEdit` hides the form from a viewer or member. That is courtesy and not the control:
 * `tenants.rename` is `requireRole("admin")` and refuses whatever the browser chose to
 * render. The note in its place names who *can*, so a reader who cannot is not at a dead end.
 *
 * No `useState`, per `state.md`. The input is uncontrolled and read through a ref on submit;
 * whether the request is in flight and why it failed are read off the mutation, which is the
 * only thing that actually knows either.
 */

import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { Errata } from "@/components/Errata.tsx";
import { trpc } from "@/trpc.ts";

export function DisplayNameForm({
  tenantId,
  displayName,
  canEdit,
}: {
  tenantId: string;
  displayName: string;
  canEdit: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const nameField = useRef<HTMLInputElement>(null);

  const rename = trpc.tenants.rename.useMutation({
    onSuccess: async () => {
      // Both caches hold this name: this page reads `tenants.get`, and the customers list
      // renders it in every row. Invalidating one would leave the other showing the old name
      // until it happened to refetch -- two copies of one value, drifting.
      await utils.tenants.get.invalidate({ tenantId });
      await utils.tenants.list.invalidate();
    },
  });

  if (!canEdit) {
    return <p className="note">{t("tenants.renameNote")}</p>;
  }

  return (
    <>
      <p className="note">{t("tenants.renameLead")}</p>

      <form
        className="stack stack--tight"
        onSubmit={(event) => {
          event.preventDefault();
          rename.mutate({ tenantId, displayName: nameField.current?.value.trim() ?? "" });
        }}
      >
        <div className="field">
          <label className="label" htmlFor="tenant-display-name">
            {t("tenants.nameLabel")}
          </label>
          <input
            autoComplete="off"
            className="input"
            // The current name as the starting value, not a placeholder: an operator
            // correcting a typo edits what is there rather than retyping it from memory.
            // Keyed by the name so a change from anywhere else remounts the field -- an
            // uncontrolled input ignores every later `defaultValue` on its own.
            defaultValue={displayName}
            disabled={rename.isPending}
            id="tenant-display-name"
            key={displayName}
            name="displayName"
            placeholder={t("tenants.namePlaceholder")}
            ref={nameField}
            type="text"
          />
        </div>

        <button className="plate" disabled={rename.isPending} type="submit">
          {rename.isPending ? t("tenants.renaming") : t("tenants.rename")}
        </button>
      </form>

      {/* The server's own words. A refusal here is one the operator can act on -- the wrong
          role, or a name past the length limit -- and restating it locally would be a second
          copy to keep in step with the refusal that actually happened. */}
      {rename.isError ? (
        <Errata heading={t("tenants.notRenamed")} live={true}>
          {rename.error.message}
        </Errata>
      ) : null}

      {rename.isSuccess ? (
        <Errata heading={t("tenants.renameHead")} live={true}>
          {t("tenants.renamed")}
        </Errata>
      ) : null}
    </>
  );
}
