/**
 * The customers division: the book's table of contents.
 *
 * One line per member company, the tenant id in mono where an operator's eye already looks
 * for it, and the role as a word. The list comes from `trpc.tenants.list`, whose query IS
 * the visibility boundary -- it returns only tenants the caller is a member of.
 *
 * "Tenant id" on screen, and it is the SAME value `.claude/rules/pii.md` calls a CASE-id:
 * `ops.tenant.id`, which this form writes and the raw lake then uses as an object-key prefix.
 * The rule's name for it never reached the UI well -- an operator reading "the reference is a
 * CASE-id" could not tell whether that was a second identifier alongside the tenant id they
 * already had. It is not; there is one id. `CASE-0001` survives as the placeholder because
 * the SHAPE is still what pii.md requires: a neutral code and never a real client name, since
 * this value reaches an S3 path and `raw.documents.lake_key`, which dbt can read.
 *
 * The display name beside it is the opposite case and is corrected on `TenantOverview`. Only
 * the id is permanent, and saying so takes two sentences because it is two promises.
 *
 * The "Add" affordance is a real form since ADR 0013, and it is shown only to a platform
 * superadmin. Hiding it from everyone else is courtesy and not the control: `tenants.create`
 * is a `superadminProcedure` and refuses whatever the browser decided to render. The note in
 * its place says who *can* do it, because a dead end the reader cannot act on is worse than
 * no affordance at all.
 *
 * No `useState`, per `state.md`. Both inputs are uncontrolled and read through refs on
 * submit; whether the request is in flight and why it failed are read off the mutation,
 * which is the only thing that actually knows either.
 */

// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: These are the functions that hold one decision each -- the connector page loop, the deploy poller, the grant migration -- and the way to shorten them is to split one sequential procedure across several names, which makes the order it happens in harder to follow rather than easier.
// biome-ignore-all lint/correctness/useUniqueElementIds: Static ids on the two single-instance forms in the app -- a sign-in panel and a create-customer form, neither of which can appear twice on a page. The id is what the <label> points at.
// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as useExplicitType: what remains are contextually-typed callbacks whose inferred type is a React or tRPC shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- React's event handlers, tRPC's builders -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/nursery/useReactNamingConvention: Fires on the two `useRef` handles, which it wants suffixed `Ref`. They are named for what they hold -- the reference field and the name field -- which is how the form reads, and the convention this file follows is People.tsx's beside it.
// biome-ignore-all lint/performance/noJsxPropsBind: An inline submit handler on a single form. The re-render the rule is about matters under a memoised list of hundreds; this is one <form>.
// biome-ignore-all lint/performance/useSolidForComponent: Solid-domain rule: it wants Solid's `<For>`, which does not exist in React. `Array#map` is how React renders a list.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for it makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off.

import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { EmptyState } from "@/components/EmptyState.tsx";
import { Errata } from "@/components/Errata.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { trpc } from "@/trpc.ts";

export function Tenants(): React.JSX.Element {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const idField = useRef<HTMLInputElement>(null);
  const nameField = useRef<HTMLInputElement>(null);

  const tenants = trpc.tenants.list.useQuery();
  const session = trpc.session.me.useQuery();

  const addTenant = trpc.tenants.create.useMutation({
    onSuccess: async () => {
      if (idField.current !== null) {
        idField.current.value = "";
      }
      if (nameField.current !== null) {
        nameField.current.value = "";
      }
      // The new customer belongs in the list beside the others, and the cache is the only
      // copy of that list -- there is no second one here to keep in step.
      await utils.tenants.list.invalidate();
    },
  });

  if (tenants.isPending) {
    return <Skeleton rows={4} />;
  }

  if (tenants.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("tenants.notLoaded")}
      </Errata>
    );
  }

  const list = tenants.data;

  return (
    <div className="sheet">
      <div className="head head--division">{t("nav.customers")}</div>
      <div className="body stack">
        <h1>{t("tenants.title")}</h1>
        <p className="prose prose--lead">{t("tenants.lead")}</p>

        {list.length === 0 ? (
          <EmptyState title={t("tenants.emptyTitle")} body={t("tenants.emptyBody")} />
        ) : (
          <table className="table">
            {/* The noun agrees with the count through i18next's plural forms, not through a
                ternary: "1 customer" and "4 customers" is an English rule, and hard-coding
                it here would have produced "1 khách hàngs" the moment a second language
                arrived. */}
            <caption>{t("tenants.caption", { count: list.length })}</caption>
            <thead>
              <tr>
                <th scope="col">{t("tenants.colCustomer")}</th>
                <th scope="col">{t("tenants.colReference")}</th>
                <th scope="col">{t("tenants.colRole")}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((tenant) => (
                <tr key={tenant.id}>
                  <td>
                    <Link to={`/tenants/${tenant.id}`}>{tenant.displayName || tenant.id}</Link>
                  </td>
                  <td className="datum datum--quiet">{tenant.id}</td>
                  <td>{tenant.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="band-rule" />

      <div className="head">{t("tenants.addHead")}</div>
      <div className="body stack">
        {session.data?.superadmin === true ? (
          <>
            <p className="note">{t("tenants.addLead")}</p>

            <form
              className="stack stack--tight"
              onSubmit={(event) => {
                event.preventDefault();
                const tenantId = idField.current?.value.trim() ?? "";
                const displayName = nameField.current?.value.trim() ?? "";
                if (tenantId === "") {
                  return;
                }
                addTenant.mutate({ tenantId, displayName });
              }}
            >
              <div className="field">
                <label className="label" htmlFor="tenant-id">
                  {t("tenants.idLabel")}
                </label>
                <input
                  autoComplete="off"
                  className="input"
                  disabled={addTenant.isPending}
                  id="tenant-id"
                  name="tenantId"
                  placeholder={t("tenants.idPlaceholder")}
                  ref={idField}
                  required={true}
                  type="text"
                />
                <p className="field__hint">{t("tenants.idHint")}</p>
              </div>

              <div className="field">
                <label className="label" htmlFor="tenant-name">
                  {t("tenants.nameLabel")}
                </label>
                <input
                  autoComplete="off"
                  className="input"
                  disabled={addTenant.isPending}
                  id="tenant-name"
                  name="displayName"
                  placeholder={t("tenants.namePlaceholder")}
                  ref={nameField}
                  type="text"
                />
              </div>

              <button className="plate" disabled={addTenant.isPending} type="submit">
                {addTenant.isPending ? t("tenants.adding") : t("tenants.add")}
              </button>
            </form>

            {/* The server's own words. A reference already in use is the one failure an
                operator can act on, and it arrives worded in their language from
                `error.tenantExists` -- restating it here would be a second copy to keep in
                step with the refusal that actually happened. */}
            {addTenant.isError ? (
              <Errata heading={t("tenants.notAdded")} live={true}>
                {addTenant.error.message}
              </Errata>
            ) : null}
          </>
        ) : (
          <p className="note">{t("tenants.addNote")}</p>
        )}
      </div>
    </div>
  );
}
