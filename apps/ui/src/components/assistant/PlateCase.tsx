/**
 * The plates the assistant may set, and nothing else.
 *
 * A tool declares which plate renders its result (`catalogue.ts`), and this is the closed case
 * those names index into. The model supplies data; it never supplies markup. `Figure.tsx`
 * records why an HTML tool was rejected outright.
 *
 * WHY THESE ARE BUILT FROM THE STYLESHEET RATHER THAN FROM THE ROUTE COMPONENTS.
 *
 * The obvious move is to reuse `ConnectionCard` and `RunRow` -- the application already draws
 * a grant and a run, so why draw them twice? Because those components take ROUTE-SHAPED props:
 * `ConnectionCard` wants four tRPC mutations and renders a hinged scope panel; `RunRow` wants a
 * link target inside the Journal. Handing them a tool's output would mean either inventing
 * mutations for a panel that must not mutate, or loosening their props until they no longer
 * describe what they draw.
 *
 * So what is reused is the VOCABULARY: `.table`, `.mark--*` through `StatusMark`, `.datum`,
 * `.label`, the em dash for absence. Same ink, same measure, same status geometry -- without
 * dragging a route into a 24rem panel. `StatusMark` itself IS reused, because it takes a mark
 * and a label and nothing else.
 *
 * EVERY RENDERER NARROWS ITS INPUT AND SHOWS WHAT IT CAN CONFIRM. The data came from a tool
 * call the model composed, so a field may be missing or a shape may be older than this code. A
 * renderer that asserted its type would draw `undefined` into a cell; these show an em dash
 * instead, which is the Absence Rule and is visibly missing rather than invisibly wrong.
 */

import { useTranslation } from "react-i18next";

import { EmptyState } from "@/components/EmptyState.tsx";
import { StatusMark } from "@/components/StatusMark.tsx";

/** An em dash in the quiet ink: a value the tool did not give us. The Absence Rule. */
const ABSENT = "—";

function rowsOf(output: unknown): readonly Record<string, unknown>[] {
  const list = Array.isArray(output)
    ? output
    : output !== null &&
        typeof output === "object" &&
        "items" in output &&
        Array.isArray(output.items)
      ? output.items
      : output !== null &&
          typeof output === "object" &&
          "hits" in output &&
          Array.isArray(output.hits)
        ? output.hits
        : [];
  return list.filter(
    (row): row is Record<string, unknown> => row !== null && typeof row === "object",
  );
}

function cell(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return ABSENT;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  // An object in a cell is a nested shape this plate has no column for. Named, not printed:
  // `[object Object]` in a table is worse than saying there is more here.
  return Array.isArray(value) ? `${value.length}` : ABSENT;
}

/**
 * Rows, as a schedule.
 *
 * Columns come from the FIRST row's keys rather than from a hand-written list, because the
 * tools this renders answer with several different shapes and a fixed list would silently drop
 * a column the reader asked about. `slice(0, 6)` because a 24rem sheet cannot set twelve
 * columns and pretending otherwise gives the reader six unreadable ones.
 */
function TablePlate({ output }: { output: unknown }): React.JSX.Element | null {
  const { t } = useTranslation();
  const rows = rowsOf(output);
  const [first] = rows;
  if (first === undefined) {
    return null;
  }
  const columns = Object.keys(first).slice(0, 6);

  return (
    <table className="table">
      {/* The count goes through i18next's own plural and number formatting rather than through
          `formatCount`: this is a COUNT and follows the reader's language, which is exactly the
          distinction `.claude/rules/i18n.md` draws against an amount. */}
      <caption className="label">{t("assistant.figureRows", { count: rows.length })}</caption>
      <thead>
        <tr>
          {columns.map((name) => (
            <th key={name}>{name}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 20).map((row, index) => (
          // The row's own id when it has one: these lists arrive whole rather than streaming,
          // so an index is stable here in a way it is not for a growing transcript.
          <tr key={cell(row.id ?? row.lakeKey ?? index)}>
            {columns.map((name) => (
              <td className="datum" key={name}>
                {cell(row[name])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The four sources and where each stands. Geometry first, word second -- `StatusMark`'s rule. */
function GrantsPlate({ output }: { output: unknown }): React.JSX.Element | null {
  const rows = rowsOf(output);
  if (rows.length === 0) {
    return null;
  }

  return (
    <dl className="proof__args">
      {rows.map((row) => (
        <div className="proof__arg" key={cell(row.source)}>
          <dt className="datum">{cell(row.source)}</dt>
          <dd>
            <StatusMark
              // `connected` is the only status that is unambiguously granted; everything else
              // is reported as what it is rather than mapped optimistically. A source shown
              // granted when it is not is the one error this panel must not make.
              mark={row.status === "connected" ? "granted" : "absent"}
              label={cell(row.status)}
            />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One object, as a margin of facts.
 *
 * The fallback plate, and the honest one: a shape this case has no purpose-built renderer for
 * is still shown field by field rather than summarised into prose the model would have to be
 * trusted about.
 */
function FactsPlate({ output }: { output: unknown }): React.JSX.Element | null {
  if (output === null || typeof output !== "object") {
    return null;
  }
  const fields = Object.entries(output).slice(0, 12);
  if (fields.length === 0) {
    return null;
  }

  return (
    <dl className="proof__args">
      {fields.map(([name, value]) => (
        <div className="proof__arg" key={name}>
          <dt className="label">{name}</dt>
          <dd className="datum">{cell(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Nothing came back, and the reader is told so rather than shown a blank.
 *
 * `.unprinted` -- the empty division's own leaf -- because "there are no rows" is a real answer
 * to a real question, where an empty frame looks like a panel that failed.
 */
function NothingFound(): React.JSX.Element {
  const { t } = useTranslation();
  return <EmptyState title={t("assistant.foundNothing")} body={t("common.nothingToShow")} />;
}

/** Which renderer a plate name indexes into. */
export function Plate({ plate, output }: { plate: string; output: unknown }): React.JSX.Element {
  if (output === null || (Array.isArray(output) && output.length === 0)) {
    return <NothingFound />;
  }

  // `facts` and anything unrecognised: rows if it is a list, fields if it is one object. Both
  // are truthful about a shape nobody anticipated, which is the property that matters.
  const drawn =
    plate === "grants" ? (
      <GrantsPlate output={output} />
    ) : plate === "table" || plate === "runs" || plate === "questions" || Array.isArray(output) ? (
      <TablePlate output={output} />
    ) : (
      <FactsPlate output={output} />
    );

  // A renderer answers `null` when it could not find anything it recognised. Saying so beats
  // drawing an empty figure frame with a caption over it.
  return drawn ?? <NothingFound />;
}
