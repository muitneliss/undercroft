/**
 * What an answer says about the tables it read, above its rows (issue 456, ADR 0129): one line
 * per table whose latest tests fail or have no record, naming the run. The rows are drawn
 * whole below it; this only qualifies them, as ADR 0090 asks of a figure Reports cannot stand
 * fully behind.
 *
 * Nothing is drawn when every table read is passing (`[]`). When which tables were read is not
 * known (`null`), it says so -- silence would read as "nothing to qualify". A table whose rows
 * the reader sees only some of is named first (ADR 0143): their total is not the table's.
 */

import { useTranslation } from "react-i18next";

import type { QualifiedAnswer } from "@/api/types.ts";
import { qualifierSentences } from "@/lib/testState.ts";

export function AnswerQualifiers({
  qualifiers,
  rowsLimited,
}: {
  qualifiers: QualifiedAnswer["qualifiers"];
  /**
   * The tables read of which the reader sees only some rows (ADR 0143): a total over one is the
   * total of what they may see, and the answer says so above the figure.
   */
  rowsLimited: QualifiedAnswer["rowsLimited"];
}): React.JSX.Element | null {
  const { t } = useTranslation();
  if (qualifiers === null) {
    return <p className="note">{t("bi.qualifiersNotKnown")}</p>;
  }
  const limited = rowsLimited ?? [];
  if (qualifiers.length === 0 && limited.length === 0) {
    return null;
  }
  return (
    <section aria-label={t("bi.qualifiersLabel")} className="stack stack--tight" role="status">
      {limited.length === 0 ? null : (
        <p className="note">{t("bi.rowsLimited", { tables: limited.join(", ") })}</p>
      )}
      {qualifiers.map((qualifier) => (
        <p className="note" key={qualifier.table}>
          {qualifierSentences(t, qualifier).join(" ")}
        </p>
      ))}
    </section>
  );
}
