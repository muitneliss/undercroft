/**
 * A signed-in page: the book opened at one division.
 *
 * `tenantId` comes from the route rather than from state, so a link, a reload and the back
 * button all land in the same place -- see `.claude/rules/state.md`. Which URL opens which
 * division is `@/routeTable`; this is only the frame those routes render into.
 */

import type { ReactNode } from "react";
import { Navigate, useParams } from "react-router-dom";

import { Book } from "@/components/Book.tsx";
import type { DivisionId } from "@/lib/divisions.ts";

export function Opened({
  division,
  signedInAs,
  children,
}: {
  division: DivisionId;
  signedInAs: string;
  children: (tenantId: string) => ReactNode;
}): React.JSX.Element {
  const params = useParams();
  const { tenantId } = params;

  if (!tenantId) {
    return <Navigate to="/tenants" replace={true} />;
  }

  return (
    <Book tenantId={tenantId} current={division} signedInAs={signedInAs}>
      {children(tenantId)}
    </Book>
  );
}
