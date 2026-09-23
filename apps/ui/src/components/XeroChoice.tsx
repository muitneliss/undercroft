/**
 * Xero's choice: one organisation, and which entities.
 *
 * Xero is a third shape among the scope pickers: one consent can see several organisations,
 * and the platform must be told which one rather than guess. The list comes through the
 * worker like Gmail's labels; the choice is one organisation and any number of the spec's
 * entities, where none means all of them.
 *
 * Its own module for the reason `LabelIndex` has one: it is a control, not a page.
 */

import { useTranslation } from "react-i18next";

import { describeXeroEntity, XERO_ENTITIES } from "@/lib/xeroEntities.ts";
import { useUiStore } from "@/store.ts";

/**
 * Xero's choice: one organisation, and which entities.
 *
 * Both halves are read from the store and written to it, for the reason the label index
 * gives. The entity list is the spec's, in the spec's order, with the words a reader sees
 * translated and the ids that get recorded left as they are.
 */
export function XeroChoice({
  source,
  organisations,
  organisation,
  entities,
}: {
  /** Which connection the draft is for; the store keys the draft by it. */
  source: string;
  organisations: readonly { id: string; name: string }[];
  organisation: { id: string; name: string } | null;
  entities: readonly string[];
}): React.JSX.Element {
  const { t } = useTranslation();
  const setOrganisation = useUiStore((s) => s.setScopeOrganisation);
  const toggleEntity = useUiStore((s) => s.toggleScopeEntity);

  if (organisations.length === 0) {
    return <p className="note">{t("scopePicker.noOrganisations")}</p>;
  }

  return (
    <>
      <fieldset className="index">
        <legend className="label index__legend">{t("scopePicker.organisationsHead")}</legend>
        <div className="index__field">
          <div className="index__cols">
            {organisations.map((candidate) => (
              <label key={candidate.id} className="punch">
                <input
                  type="radio"
                  name="organisation"
                  checked={organisation?.id === candidate.id}
                  onChange={(): void => {
                    setOrganisation(source, { id: candidate.id, name: candidate.name });
                  }}
                />
                <span className="punch__box" />
                <span>{candidate.name}</span>
              </label>
            ))}
          </div>
        </div>
      </fieldset>

      <fieldset className="index">
        <legend className="label index__legend">{t("scopePicker.entitiesHead")}</legend>
        <div className="index__field">
          <div className="index__cols">
            {XERO_ENTITIES.map((entity) => (
              <label key={entity} className="punch">
                <input
                  type="checkbox"
                  checked={entities.includes(entity)}
                  onChange={(): void => {
                    toggleEntity(source, entity);
                  }}
                />
                <span className="punch__box" />
                <span>{describeXeroEntity(t, entity)}</span>
              </label>
            ))}
          </div>
        </div>
      </fieldset>

      <div className="echo">
        <span className="label">{t("scopePicker.echoHead")}</span>
        <p className="note echo__says" role="status">
          {entities.length === 0
            ? t("scope.xeroAll")
            : t("scope.xeroEntities", {
                entities: entities.map((entity) => describeXeroEntity(t, entity)).join(", "),
              })}
        </p>
      </div>
    </>
  );
}
