/**
 * A query result, printed: the one table every tenant-scoped read is drawn with -- a
 * model's preview after a build, the rows a failed test stored, a question's answer.
 *
 * Column headers carry the Postgres type in the quiet face, because "amount numeric" and
 * "amount text" are different facts about a model and the author is the one who can fix
 * the second. Cells go through `cellText`: a numeric string prints every digit, null is
 * visibly missing.
 */

// biome-ignore-all lint/correctness/noSolidDestructuredProps: Solid-domain rule: destructuring props defeats Solid's reactivity, because there `props` is a proxy. React props are a plain object and destructuring them is the idiomatic form.
// biome-ignore-all lint/performance/useSolidForComponent: Solid-domain rule: it wants Solid's `<For>`, which does not exist in React. `Array#map` is how React renders a list.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/suspicious/noArrayIndexKey: A result row has no identity but its position: two identical rows are two rows, and the list is replaced whole on every run rather than edited in place, so the reorder hazard the rule describes cannot arise.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for it makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off.

import type { Locale } from "@undercroft/core/locale";
import { useTranslation } from "react-i18next";

import type { TableResult } from "@/api/types.ts";
import { cellText } from "@/lib/cells.ts";

export function ResultTable({
  result,
  locale,
}: {
  result: TableResult;
  locale: Locale;
}): React.JSX.Element {
  const { t } = useTranslation();

  if (result.rows.length === 0) {
    return <p className="note">{t("result.empty")}</p>;
  }

  return (
    <div className="stack stack--tight">
      <div className="result">
        <table className="table">
          <caption>{t("result.caption", { count: result.rows.length })}</caption>
          <thead>
            <tr>
              {result.columns.map((column) => (
                <th key={column.name} scope="col">
                  {column.name}
                  <span className="datum datum--quiet result__type">{column.type}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="datum">
                    {cellText(t, cell, locale)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.truncated ? (
        <p className="note">{t("result.truncated", { count: result.rows.length })}</p>
      ) : null}
    </div>
  );
}
