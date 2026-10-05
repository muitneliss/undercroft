/**
 * One model's business context, on its own editor: its state and why, the context that was
 * approved, and -- for an admin -- the form that approves a new one. ADR 0104.
 *
 * The state is the server's, read with the model (`models.get`), so this page, the CLI and an
 * MCP client all show the same one. A context that needs review keeps its approved text on
 * screen, BELOW the reasons: the old description is still the best one there is, and hiding it
 * would leave a reader with less than they had. What the server found without judging meaning
 * -- columns the context names that the last build did not have, an upstream lineage cannot
 * read -- is said as found.
 *
 * Every word here is about documentation. A declared key is called declared, never unique, and
 * one sentence says outright that this is not a test of the data: a reader who took `current`
 * for "checked" would trust a key nobody tested.
 */

import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import type { ModelDetail } from "@/api/types.ts";
import { ContextForm, type ContextSave } from "@/components/ModelContextForm.tsx";
import { StatusMark } from "@/components/StatusMark.tsx";
import { changeLine, contextMark, contextStateLabel, sectionLabel } from "@/lib/modelContext.ts";
import { MISSING } from "@/lib/money.ts";
import { relativeTime } from "@/lib/when.ts";
import { useUiStore } from "@/store.ts";

type Context = ModelDetail["context"];
type Body = NonNullable<Context["body"]>;

export function ContextBand({
  tenantId,
  stored,
  isAdmin,
  sqlDirty,
  busy,
  approve,
}: {
  tenantId: string;
  stored: ModelDetail;
  isAdmin: boolean;
  /** The SQL on screen is not what the server holds, so its definition is not yet approvable. */
  sqlDirty: boolean;
  busy: boolean;
  approve: ContextSave;
}): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const { context } = stored;

  return (
    <section aria-label={t("models.contextHead")} className="body stack">
      <p className="prose">{t("models.contextLead")}</p>
      <div className="row">
        <StatusMark label={contextStateLabel(t, context.state)} mark={contextMark(context.state)} />
        {context.reviewedAt === null ? null : (
          <span className="datum datum--quiet">
            {t("models.contextReviewed", { when: relativeTime(context.reviewedAt, locale) })}
          </span>
        )}
      </div>
      <p className="note">{t("models.contextNotATest")}</p>
      <ContextFindings context={context} self={stored.name} />
      {context.body === null ? (
        <p className="datum datum--quiet">{t("models.contextNone")}</p>
      ) : (
        <ApprovedContext body={context.body} />
      )}
      {isAdmin ? (
        <ContextForm
          approve={approve}
          busy={busy}
          sqlDirty={sqlDirty}
          stored={stored}
          tenantId={tenantId}
        />
      ) : null}
    </section>
  );
}

/** Why the state is what it is, and what the server saw without judging meaning. */
function ContextFindings({ context, self }: { context: Context; self: string }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      {context.changes.length > 0 ? (
        <>
          <h2 className="label">{t("models.contextChangesHead")}</h2>
          <ul className="note">
            {context.changes.map((change) => (
              <li key={`${change.model}|${change.kind}`}>{changeLine(t, self, change)}</li>
            ))}
          </ul>
        </>
      ) : null}
      {context.missing.length > 0 ? (
        <>
          <h2 className="label">{t("models.contextMissingHead")}</h2>
          <ul className="note">
            {context.missing.map((section) => (
              <li key={section}>{sectionLabel(t, section)}</li>
            ))}
          </ul>
        </>
      ) : null}
      {context.absentColumns !== null && context.absentColumns.length > 0 ? (
        <p className="note">
          {t("models.contextAbsentColumns", { columns: context.absentColumns.join(", ") })}
        </p>
      ) : null}
      {context.upstreamUndeclared ? (
        <p className="note">{t("models.contextUpstreamUndeclared")}</p>
      ) : null}
    </>
  );
}

/** The context as it was approved: each section under its name, a blank one as MISSING. */
function ApprovedContext({ body }: { body: Body }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="stack stack--tight">
      <Section label={t("models.contextPurpose")} text={body.purpose} />
      <Section label={t("models.contextGrain")} text={body.grain} />
      <span className="label">{t("models.contextKeyDeclared")}</span>
      <p className="prose">{keyText(t, body.key)}</p>
      <span className="label">{t("models.contextColumns")}</span>
      {body.columns.length === 0 ? (
        <p className="missing">{MISSING}</p>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t("models.colColumn")}</th>
                <th scope="col">{t("models.colDefinition")}</th>
                <th scope="col">{t("models.colUnit")}</th>
              </tr>
            </thead>
            <tbody>
              {body.columns.map((column) => (
                <tr key={column.name}>
                  <td className="datum">{column.name}</td>
                  <td>{orMissing(column.definition)}</td>
                  <td className="datum">{column.unit ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <span className="label">{t("models.contextRules")}</span>
      {body.rules?.kind === "listed" && body.rules.items.length > 0 ? (
        <ul className="prose">
          {body.rules.items.map((rule, index) => (
            <li key={index}>{rule}</li>
          ))}
        </ul>
      ) : (
        <p className="prose">{rulesText(t, body.rules)}</p>
      )}
    </div>
  );
}

function Section({ label, text }: { label: string; text: string }): React.JSX.Element {
  return (
    <>
      <span className="label">{label}</span>
      <p className="prose">{orMissing(text)}</p>
    </>
  );
}

/** A blank answer is visibly missing, never an empty line that reads as "nothing to say". */
function orMissing(text: string): string {
  return text.trim() === "" ? MISSING : text;
}

function keyText(t: TFunction, key: Body["key"]): string {
  if (key === null) {
    return MISSING;
  }
  if (key.kind === "none") {
    return t("models.contextKeyNone", { reason: orMissing(key.reason) });
  }
  return key.columns.length === 0 ? MISSING : key.columns.join(", ");
}

/** "None" is an answer; no answer, or a list with nothing in it, is not. */
function rulesText(t: TFunction, rules: Body["rules"]): string {
  return rules?.kind === "none" ? t("models.contextRulesNone") : MISSING;
}
