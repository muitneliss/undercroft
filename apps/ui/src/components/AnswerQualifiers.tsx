/**
 * What an answer says about the tables it read, above its rows (issue 456, ADR 0129): one line
 * per table whose latest tests fail or have no record, naming the run. The rows are drawn
 * whole below it; this only qualifies them, as ADR 0090 asks of a figure Reports cannot stand
 * fully behind.
 *
 * Nothing is drawn when every table read is passing (`[]`). When which tables were read is not
 * known (`null`), it says so -- silence would read as "nothing to qualify".
 */

import { useTranslation } from "react-i18next";

import type { QualifiedAnswer } from "@/api/types.ts";
import { qualifierSentences } from "@/lib/testState.ts";

export function AnswerQualifiers({
  qualifiers,
}: {
  qualifiers: QualifiedAnswer["qualifiers"];
}): React.JSX.Element | null {
  const { t } = useTranslation();
  if (qualifiers === null) {
    return <p className="note">{t("bi.qualifiersNotKnown")}</p>;
  }
  if (qualifiers.length === 0) {
    return null;
  }
  return (
    <section aria-label={t("bi.qualifiersLabel")} className="stack stack--tight" role="status">
      {qualifiers.map((qualifier) => (
        <p className="note" key={qualifier.table}>
          {qualifierSentences(t, qualifier).join(" ")}
        </p>
      ))}
    </section>
  );
}
