/**
 * The lineage drawn: columns of nodes, the declared edges between them, the selected model's
 * upstream chain inked and everything else dimmed.
 *
 * The drawing needs no measuring. Every row is one height and every column one share of the
 * width, so a node's place is its (column, row) from `layout` and the edges are drawn in those
 * same units, in an SVG stretched over the grid whose strokes do not stretch with it. That is
 * why the grid's tracks and each cell's place are inline styles: they are the graph's shape,
 * computed per tenant, which no class written beforehand could hold (`biome.jsonc`).
 *
 * It draws only what `models.lineage` returned; there is nothing here that could add an edge.
 * Below 760px the sheet hides it, and the text list in `ModelLineage` is the view.
 */

import { useTranslation } from "react-i18next";

import type { ModelLineage as Graph } from "@/api/types.ts";
import { NodeLink } from "@/components/LineageNode.tsx";
import { type Focus, layout, nodeState, nodeWords } from "@/lib/lineage.ts";

/** The share of a column a node takes; `.lineage__node`'s width in `index.css` is the same. */
const NODE_SHARE = 0.82;
/** Where an edge meets a node: the middle of its row. */
const MIDDLE = 0.5;

function edgeClass(focus: Focus, from: string, to: string, missing: boolean): string {
  const classes = ["lineage__edge"];
  if (missing) {
    classes.push("lineage__edge--missing");
  }
  if (focus.chain !== null) {
    const onChain = focus.chain.has(from) && focus.chain.has(to);
    classes.push(onChain ? "lineage__edge--chain" : "lineage__edge--dim");
  }
  return classes.join(" ");
}

export function LineageDrawing({
  graph,
  focus,
  tenantId,
}: {
  graph: Graph;
  focus: Focus;
  tenantId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { placed, columns, rows } = layout(graph);
  const at = new Map(placed.map((p) => [p.node.id, p]));

  return (
    <figure aria-label={t("lineage.drawingLabel")} className="lineage">
      <div
        className="lineage__grid"
        style={{
          gridTemplateColumns: `repeat(${String(columns)}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${String(rows)}, var(--lineage-row))`,
        }}
      >
        <svg
          aria-hidden="true"
          className="lineage__edges"
          preserveAspectRatio="none"
          viewBox={`0 0 ${String(columns)} ${String(rows)}`}
        >
          {graph.edges.map((edge) => {
            const [from, to] = [at.get(edge.from), at.get(edge.to)];
            if (from === undefined || to === undefined || edge.from === edge.to) {
              return null;
            }
            const [x1, y1] = [from.column + NODE_SHARE, from.row + MIDDLE];
            const [x2, y2] = [to.column, to.row + MIDDLE];
            const bend = String((x1 + x2) / 2);
            return (
              <path
                className={edgeClass(focus, edge.from, edge.to, from.node.kind === "missing")}
                d={`M ${String(x1)} ${String(y1)} C ${bend} ${String(y1)}, ${bend} ${String(y2)}, ${String(x2)} ${String(y2)}`}
                key={`${edge.from}|${edge.to}`}
              />
            );
          })}
        </svg>
        {placed.map(({ node, column, row }) => {
          const state = nodeState(focus, node.id);
          return (
            <div
              className="lineage__cell"
              key={node.id}
              style={{ gridColumn: column + 1, gridRow: row + 1 }}
            >
              <NodeLink
                className={`lineage__node lineage__node--${node.kind} lineage__node--${state}`}
                current={state === "selected"}
                node={node}
                tenantId={tenantId}
              >
                <span className="lineage__name">{node.name}</span>
                <span className="lineage__words">{nodeWords(t, node, state).join(" · ")}</span>
              </NodeLink>
            </div>
          );
        })}
      </div>
    </figure>
  );
}
