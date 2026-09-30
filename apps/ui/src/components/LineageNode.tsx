/**
 * Where pressing a lineage node goes, for the drawing and the text list alike, so the two
 * cannot send a reader to different places. What a node SAYS is `nodeWords` in `lib/lineage`.
 */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import type { LineageNode } from "@/api/types.ts";
import { divisionPath } from "@/lib/divisions.ts";
import { lineagePath } from "@/lib/lineage.ts";

/**
 * A node as a door: a model selects itself, a raw lake table opens the Raw lake division, and
 * a missing dependency, which is nowhere, is text.
 */
export function NodeLink({
  node,
  tenantId,
  className,
  current,
  children,
}: {
  node: LineageNode;
  tenantId: string;
  className: string;
  current: boolean;
  children: ReactNode;
}): React.JSX.Element {
  if (node.kind === "missing") {
    return <span className={className}>{children}</span>;
  }
  const to =
    node.kind === "raw" ? divisionPath("lake", tenantId) : lineagePath(tenantId, node.name);
  return (
    <Link className={className} to={to} {...(current ? { "aria-current": "true" as const } : {})}>
      {children}
    </Link>
  );
}
