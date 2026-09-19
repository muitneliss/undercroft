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

// biome-ignore-all lint/correctness/noSolidDestructuredProps: Solid-domain rule: destructuring props defeats Solid's reactivity, because there `props` is a proxy. React props are a plain object and destructuring them is the idiomatic form.
// biome-ignore-all lint/correctness/useUniqueElementIds: A static id on a single-instance form, matching the create-customer form in Tenants.tsx. The id is what this field's <label> points at, and the component renders once per page -- the duplicate-id hazard the rule describes needs a second instance, which the route does not create.
// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as the routes: what remains are contextually-typed callbacks whose inferred type is a React or tRPC shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- React's event handlers, tRPC's builders -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/nursery/useReactNamingConvention: Fires on the `nameField` handle, which it wants suffixed `Ref`. It is named for what it holds -- the name field -- which is how the form reads, and the convention this follows is Tenants.tsx's beside it.
// biome-ignore-all lint/performance/noJsxPropsBind: An inline submit handler on a single form. The re-render the rule is about matters under a memoised list of hundreds; this is one <form>.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for it makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off.

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
