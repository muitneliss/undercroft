/**
 * Where pressing a node in the lineage's text list goes. What a node SAYS is `nodeWords` in
 * `lib/lineage`.
 */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import type { LineageNode } from "@/api/types.ts";
import { lineagePath } from "@/lib/lineage.ts";

/**
 * A node as a door to itself: every node -- a model, a raw lake table, a missing dependency --
 * selects itself, as its card on the board does, and the details beside the board say where
 * else it leads (ADR 0097).
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
  return (
    <Link
      className={className}
      to={lineagePath(tenantId, node.name)}
      {...(current ? { "aria-current": "true" as const } : {})}
    >
      {children}
    </Link>
  );
}
