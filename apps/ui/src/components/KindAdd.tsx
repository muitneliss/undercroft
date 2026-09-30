/**
 * Adding a kind to the catalogue's draft: one from the generic catalogue, or one of the
 * tenant's own with a description. ADR 0085.
 *
 * Two forms rather than one with a switch, because they ask for different things: a generic
 * kind brings its own description, and a custom one has nothing BUT its description for the
 * classifier to read. Both are uncontrolled and read through refs on submit, as `People`'s
 * invitation is; the name pattern is the server's (`DocumentKindName`), stated here as the
 * input's `pattern` only so the browser can say so before the round trip.
 */

import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Errata } from "@/components/Errata.tsx";
import type { trpc } from "@/trpc.ts";

type AddMutation = ReturnType<typeof trpc.documentKinds.add.useMutation>;

function GenericForm({
  available,
  tenantId,
  add,
}: {
  available: readonly { kind: string; description: string }[];
  tenantId: string;
  add: AddMutation;
}): React.JSX.Element {
  const { t } = useTranslation();
  const id = useId();
  const choiceRef = useRef<HTMLSelectElement>(null);
  if (available.length === 0) {
    return <p className="note">{t("kinds.addGenericNone")}</p>;
  }
  return (
    <form
      className="row row--field"
      onSubmit={(event): void => {
        event.preventDefault();
        const kind = choiceRef.current?.value ?? "";
        if (kind !== "") {
          add.mutate({ tenantId, kind });
        }
      }}
    >
      <div className="field">
        <label className="label" htmlFor={id}>
          {t("kinds.addGenericLabel")}
        </label>
        <select className="input input--select" id={id} ref={choiceRef} disabled={add.isPending}>
          {available.map((entry) => (
            <option key={entry.kind} value={entry.kind} title={entry.description}>
              {entry.kind}
            </option>
          ))}
        </select>
      </div>
      <button className="plate" type="submit" disabled={add.isPending}>
        {t("kinds.addGeneric")}
      </button>
    </form>
  );
}

function CustomForm({ tenantId, add }: { tenantId: string; add: AddMutation }): React.JSX.Element {
  const { t } = useTranslation();
  const nameId = useId();
  const descriptionId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  return (
    <form
      className="stack stack--tight"
      onSubmit={(event): void => {
        event.preventDefault();
        const form = event.currentTarget;
        const kind = nameRef.current?.value.trim() ?? "";
        const text = descriptionRef.current?.value.trim() ?? "";
        if (kind !== "" && text !== "") {
          // Emptied only once the server has the kind: a refused name stays to be corrected.
          add.mutate({ tenantId, kind, description: text }, { onSuccess: () => form.reset() });
        }
      }}
    >
      <div className="field">
        <label className="label" htmlFor={nameId}>
          {t("kinds.addCustomName")}
        </label>
        <input
          className="input mono"
          id={nameId}
          ref={nameRef}
          required={true}
          maxLength={63}
          pattern="[a-z][a-z0-9_]*"
          autoComplete="off"
          disabled={add.isPending}
        />
        <p className="field__hint">{t("kinds.addCustomNameHint")}</p>
      </div>
      <div className="field">
        <label className="label" htmlFor={descriptionId}>
          {t("kinds.addCustomDescription")}
        </label>
        <input
          className="input"
          id={descriptionId}
          ref={descriptionRef}
          required={true}
          maxLength={500}
          autoComplete="off"
          disabled={add.isPending}
        />
        <p className="field__hint">{t("kinds.addCustomDescriptionHint")}</p>
      </div>
      <div className="row">
        <button className="plate" type="submit" disabled={add.isPending}>
          {add.isPending ? t("kinds.adding") : t("kinds.addCustom")}
        </button>
      </div>
    </form>
  );
}

export function KindAdd({
  available,
  tenantId,
  add,
}: {
  available: readonly { kind: string; description: string }[];
  tenantId: string;
  add: AddMutation;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      <GenericForm available={available} tenantId={tenantId} add={add} />
      <CustomForm tenantId={tenantId} add={add} />
      {add.isError ? <Errata heading={t("kinds.notAdded")} live={true} error={add.error} /> : null}
    </>
  );
}
