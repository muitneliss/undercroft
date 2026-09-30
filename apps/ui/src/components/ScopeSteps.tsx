/**
 * The scope picker's two steps -- choose, then review and save -- as the plates that move
 * between them and the review itself. `ScopePicker`'s header says why Save waits for a review.
 *
 * Wordless about where the step is written: the route reads the address and hands down the two
 * paths, so the step's name is known in one place.
 *
 * ## The review
 *
 * What is saved beside what will apply, in the card's own words (`@/lib/scopeChange`), then
 * what leaves the scope, by name. For Drive and Gmail, those names stand under a head that says
 * what the next read does to the records the lake already holds: Drive marks what its pick no
 * longer reaches as deleted at source (ADR 0071, 0078), and Gmail leaves a message that stops
 * matching a label live. Xero and HubSpot get the names and no statement, because what their
 * next read does has not been confirmed against the read (ADR 0091); a statement nobody checked
 * is a guess set in the same type as a fact.
 */

import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import type { Connection, Source } from "@/api/types.ts";
import { Errata, type ServerError } from "@/components/Errata.tsx";
import { ArrowLeft, ArrowRight } from "@/components/Icon.tsx";
import { orMissing } from "@/lib/money.ts";
import { scopeChange } from "@/lib/scopeChange.ts";
import type { ScopeDraft } from "@/store.ts";

/** What saving does to the records the lake already holds, for the kinds where that is known. */
const HELD_KEY: Partial<Record<Source, "scopePicker.heldDrive" | "scopePicker.heldGmail">> = {
  drive: "scopePicker.heldDrive",
  gmail: "scopePicker.heldGmail",
};

/**
 * Why Save waits: a list that did not load, whose slip the choices already carry, or a Xero
 * connection with no organisation chosen, which the plates say themselves.
 */
export type SaveHold = "list" | "organisation";

/** Where each step is. Addresses, so a step is a page the reader can go Back to. */
interface StepPaths {
  readonly choose: string;
  readonly review: string;
}

/** The two steps as two plates bound as one control, the step on screen inked. */
export function ScopeSteps({
  paths,
  review,
}: {
  paths: StepPaths;
  review: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <nav aria-label={t("scopePicker.stepsLabel")} className="langset">
      <Link
        className="plate plate--small"
        to={paths.choose}
        {...(review ? {} : { "aria-current": "step" as const })}
      >
        {t("scopePicker.stepChoose")}
      </Link>
      <Link
        className="plate plate--small"
        to={paths.review}
        {...(review ? { "aria-current": "step" as const } : {})}
      >
        {t("scopePicker.stepReview")}
      </Link>
    </nav>
  );
}

/** The comparison, what leaves, and what happens to what is held. See the header. */
export function ScopeReview({
  kind,
  saved,
  chosen,
  loadError,
}: {
  kind: Source;
  saved: Connection["config"];
  chosen: Omit<ScopeDraft, "source">;
  /**
   * Why the choices did not load, if they did not. Said here too, because Save waits on it and a
   * review reached by its own plate would otherwise hold Save back without saying why.
   */
  loadError: ServerError | null;
}): React.JSX.Element {
  const { t } = useTranslation();
  const heldId = useId();
  const change = scopeChange(t, kind, saved, chosen);
  const held = HELD_KEY[kind];
  const leaving =
    change.leaving.length === 0 ? null : (
      <p className="datum">{t("scopePicker.leaving", { names: change.leaving.join(", ") })}</p>
    );

  return (
    <>
      {loadError === null ? null : (
        <Errata heading={t("common.notLoaded")} live={true} error={loadError} />
      )}
      <table className="table--words table">
        <caption>{t("scopePicker.reviewHead")}</caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="visually-hidden">{t("scopePicker.colPart")}</span>
            </th>
            <th scope="col">{t("scopePicker.colSaved")}</th>
            <th scope="col">{t("scopePicker.colWillApply")}</th>
          </tr>
        </thead>
        <tbody>
          {change.rows.map((row) => (
            <tr key={row.row}>
              <th scope="row">
                {row.row === "reads" ? t("scopePicker.rowReads") : t("scopePicker.fileTypesHead")}
              </th>
              <td>{orMissing(row.saved)}</td>
              <td>{orMissing(row.willApply)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {held === undefined ? (
        leaving
      ) : (
        <section aria-labelledby={heldId} className="stack stack--tight">
          <h2 className="label" id={heldId}>
            {t("scopePicker.heldHead")}
          </h2>
          {leaving}
          {change.subfoldersDropped ? (
            <p className="note">{t("scopePicker.subfoldersDropped")}</p>
          ) : null}
          <p className="note">{t(held)}</p>
        </section>
      )}
    </>
  );
}

/**
 * The plates at the foot of each step. The choices end in Next, the review in Save, and both
 * offer Discard. Next is held back for the reason Save is: a review of a choice nobody could
 * make is not one to offer. Why they wait is said above them, on either step.
 */
export function ScopeActions({
  paths,
  review,
  heldBack,
  saving,
  saveError,
  onSave,
  onDiscard,
}: {
  paths: StepPaths;
  review: boolean;
  heldBack: SaveHold | null;
  saving: boolean;
  /** The server's refusal of the last Save, set above the plate that was pressed. */
  saveError: ServerError | null;
  onSave: () => void;
  onDiscard: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const discard = (
    <button type="button" className="plate" disabled={saving} onClick={onDiscard}>
      {t("scopePicker.discard")}
    </button>
  );
  const why =
    heldBack === "organisation" ? (
      <p className="note">{t("scopePicker.chooseOrganisation")}</p>
    ) : null;

  if (review) {
    return (
      <>
        {saveError === null ? null : (
          <Errata heading={t("scopePicker.notSaved")} live={true} error={saveError} />
        )}
        {why}
        <div className="row">
          <Link className="plate" to={paths.choose}>
            <ArrowLeft size={13} />
            {t("scopePicker.back")}
          </Link>
          <button
            type="button"
            className="plate plate--primary"
            disabled={saving || heldBack !== null}
            onClick={onSave}
          >
            {saving ? t("scopePicker.saving") : t("scopePicker.save")}
          </button>
          {discard}
        </div>
      </>
    );
  }
  return (
    <>
      {why}
      <div className="row">
        {discard}
        <button
          type="button"
          className="plate plate--primary"
          disabled={heldBack !== null}
          onClick={(): void => {
            void navigate(paths.review);
          }}
        >
          {t("scopePicker.next")}
          <ArrowRight size={13} />
        </button>
      </div>
    </>
  );
}
