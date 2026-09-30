/**
 * The catalogue's kinds, and -- for an admin -- editing a description and removing a kind.
 *
 * Out of `routes/DocumentKinds.tsx` for the reason `Roster` is out of `People`: the page owns
 * the mutations and what they invalidate, and this table only renders and asks.
 *
 * ONE ROW OPEN AT A TIME, and which one is the store's (`kindEditing`); the text is not. The
 * field is uncontrolled and read through a ref on Save, so a keystroke re-renders nothing and a
 * refused save leaves exactly what was typed in the box to be corrected.
 *
 * `other` has no Remove: the server refuses it (a list with no "none of these" forces every
 * document into a kind, which is a guess), and a plate that could only be refused would be a
 * promise this table breaks. Its description may still be edited.
 */

import { OTHER_KIND } from "@undercroft/contracts/documentKinds";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { Errata } from "@/components/Errata.tsx";
import { sharePercent } from "@/lib/documentKinds.ts";
import { useUiStore } from "@/store.ts";
import type { trpc } from "@/trpc.ts";

export interface KindRow {
  readonly kind: string;
  readonly description: string;
  readonly origin: "initialised" | "generic" | "admin";
  readonly sampleShare: string | null;
}

export interface KindWrites {
  readonly update: ReturnType<typeof trpc.documentKinds.update.useMutation>;
  readonly remove: ReturnType<typeof trpc.documentKinds.remove.useMutation>;
}

const ORIGIN_KEY = {
  initialised: "kinds.originInitialised",
  generic: "kinds.originGeneric",
  admin: "kinds.originAdmin",
} as const;

/** The description cell while it is open: the field, Save and Cancel. */
function EditingCell({
  row,
  tenantId,
  update,
}: {
  row: KindRow;
  tenantId: string;
  update: KindWrites["update"];
}): React.JSX.Element {
  const { t } = useTranslation();
  const fieldRef = useRef<HTMLInputElement>(null);
  const close = useUiStore((state) => state.setKindEditing);
  return (
    <form
      className="row row--field"
      onSubmit={(event): void => {
        event.preventDefault();
        const description = fieldRef.current?.value.trim() ?? "";
        if (description !== "") {
          update.mutate({ tenantId, kind: row.kind, description });
        }
      }}
    >
      <div className="field">
        <input
          className="input"
          aria-label={t("kinds.descriptionFor", { kind: row.kind })}
          defaultValue={row.description}
          maxLength={500}
          required={true}
          ref={fieldRef}
          disabled={update.isPending}
        />
      </div>
      <button
        className="plate plate--small plate--primary"
        type="submit"
        disabled={update.isPending}
      >
        {update.isPending ? t("kinds.saving") : t("kinds.save")}
      </button>
      <button className="plate plate--small" type="button" onClick={(): void => close(null)}>
        {t("kinds.cancel")}
      </button>
    </form>
  );
}

/** An admin's two plates for a row that is not open. */
function RowActions({
  row,
  tenantId,
  remove,
}: {
  row: KindRow;
  tenantId: string;
  remove: KindWrites["remove"];
}): React.JSX.Element {
  const { t } = useTranslation();
  const open = useUiStore((state) => state.setKindEditing);
  const removing = remove.isPending && remove.variables.kind === row.kind;
  return (
    <div className="row">
      <button
        className="plate plate--small"
        type="button"
        onClick={(): void => open({ tenantId, kind: row.kind })}
      >
        {t("kinds.edit")}
      </button>
      {row.kind === OTHER_KIND ? (
        <span className="note">{t("kinds.otherRequired")}</span>
      ) : (
        <button
          className="plate plate--small"
          type="button"
          disabled={remove.isPending}
          onClick={(): void => remove.mutate({ tenantId, kind: row.kind })}
        >
          {removing ? t("kinds.removing") : t("kinds.remove")}
        </button>
      )}
    </div>
  );
}

function Row({
  row,
  tenantId,
  isAdmin,
  writes,
}: {
  row: KindRow;
  tenantId: string;
  isAdmin: boolean;
  writes: KindWrites;
}): React.JSX.Element {
  const { t } = useTranslation();
  const editing = useUiStore(
    (state) => state.kindEditing?.tenantId === tenantId && state.kindEditing.kind === row.kind,
  );
  return (
    <tr>
      <td className="mono">{row.kind}</td>
      <td>
        {isAdmin && editing ? (
          <EditingCell row={row} tenantId={tenantId} update={writes.update} />
        ) : (
          row.description
        )}
      </td>
      <td>{t(ORIGIN_KEY[row.origin])}</td>
      <td className="num">{sharePercent(row.sampleShare) ?? t("kinds.shareNone")}</td>
      {isAdmin ? (
        <td>
          {editing ? null : <RowActions row={row} tenantId={tenantId} remove={writes.remove} />}
        </td>
      ) : null}
    </tr>
  );
}

export function KindTable({
  kinds,
  tenantId,
  isAdmin,
  writes,
}: {
  kinds: readonly KindRow[];
  tenantId: string;
  isAdmin: boolean;
  writes: KindWrites;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      <table className="table">
        <caption>{t("kinds.caption", { count: kinds.length })}</caption>
        <thead>
          <tr>
            <th scope="col">{t("kinds.colKind")}</th>
            <th scope="col">{t("kinds.colDescription")}</th>
            <th scope="col">{t("kinds.colOrigin")}</th>
            <th scope="col">{t("kinds.colShare")}</th>
            {isAdmin ? <th scope="col">{t("kinds.colActions")}</th> : null}
          </tr>
        </thead>
        <tbody>
          {kinds.map((row) => (
            <Row key={row.kind} row={row} tenantId={tenantId} isAdmin={isAdmin} writes={writes} />
          ))}
        </tbody>
      </table>
      {writes.update.isError ? (
        <Errata heading={t("kinds.notSaved")} live={true} error={writes.update.error} />
      ) : null}
      {writes.remove.isError ? (
        <Errata heading={t("kinds.notRemoved")} live={true} error={writes.remove.error} />
      ) : null}
    </>
  );
}
