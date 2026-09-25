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

import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { EmptyState } from "@/components/EmptyState.tsx";
import { Errata, type ServerError } from "@/components/Errata.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { trpc } from "@/trpc.ts";

/**
 * Creating a customer, which only a platform superadmin may do.
 *
 * The refusal shown here is the SERVER's own words, never a restatement: a reference that is
 * already taken is something the operator can act on, and a second copy of that sentence in
 * the catalogue would drift out of step with the refusal that actually fired.
 */
function AddTenantPanel({
  isSuperadmin,
  addTenant,
  idFieldRef,
  nameFieldRef,
  tenantIdFieldId,
  tenantNameId,
}: {
  isSuperadmin: boolean;
  addTenant: {
    isPending: boolean;
    error: ServerError | null;
    mutate: (input: { tenantId: string; displayName: string }) => void;
  };
  idFieldRef: React.RefObject<HTMLInputElement | null>;
  nameFieldRef: React.RefObject<HTMLInputElement | null>;
  tenantIdFieldId: string;
  tenantNameId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      {isSuperadmin ? (
        <>
          <p className="note">{t("tenants.addLead")}</p>

          <form
            className="stack stack--tight"
            onSubmit={(event): void => {
              event.preventDefault();
              const tenantId = idFieldRef.current?.value.trim() ?? "";
              const displayName = nameFieldRef.current?.value.trim() ?? "";
              if (tenantId === "") {
                return;
              }
              addTenant.mutate({ tenantId, displayName });
            }}
          >
            <div className="field">
              <label className="label" htmlFor={tenantIdFieldId}>
                {t("tenants.idLabel")}
              </label>
              <input
                autoComplete="off"
                className="input"
                disabled={addTenant.isPending}
                id={tenantIdFieldId}
                name="tenantId"
                placeholder={t("tenants.idPlaceholder")}
                ref={idFieldRef}
                required={true}
                type="text"
              />
              <p className="field__hint">{t("tenants.idHint")}</p>
            </div>

            <div className="field">
              <label className="label" htmlFor={tenantNameId}>
                {t("tenants.nameLabel")}
              </label>
              <input
                autoComplete="off"
                className="input"
                disabled={addTenant.isPending}
                id={tenantNameId}
                name="displayName"
                placeholder={t("tenants.namePlaceholder")}
                ref={nameFieldRef}
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
          {addTenant.error === null ? null : (
            <Errata heading={t("tenants.notAdded")} live={true} error={addTenant.error} />
          )}
        </>
      ) : (
        <p className="note">{t("tenants.addNote")}</p>
      )}
    </>
  );
}

export function Tenants(): React.JSX.Element {
  const { t } = useTranslation();
  const tenantIdFieldId = useId();
  const tenantNameId = useId();
  const utils = trpc.useUtils();
  const idFieldRef = useRef<HTMLInputElement>(null);
  const nameFieldRef = useRef<HTMLInputElement>(null);

  const tenants = trpc.tenants.list.useQuery();
  const session = trpc.session.me.useQuery();

  const addTenant = trpc.tenants.create.useMutation({
    onSuccess: async () => {
      if (idFieldRef.current !== null) {
        idFieldRef.current.value = "";
      }
      if (nameFieldRef.current !== null) {
        nameFieldRef.current.value = "";
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
        <AddTenantPanel
          isSuperadmin={session.data?.superadmin === true}
          addTenant={addTenant}
          idFieldRef={idFieldRef}
          nameFieldRef={nameFieldRef}
          tenantIdFieldId={tenantIdFieldId}
          tenantNameId={tenantNameId}
        />
      </div>
    </div>
  );
}
