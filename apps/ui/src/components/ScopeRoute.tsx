/**
 * The scope picker's frame: the book opened at the sources division for one source.
 *
 * Its own component rather than an `Opened` child because the source in the URL is a value
 * from outside and is checked before anything reads it: an unknown one sends the reader back
 * to the customer's own page rather than opening a picker for a source that does not exist.
 *
 * The URL names an ACCOUNT -- `gmail` or `gmail.3fa9c1d2e0ab` (ADR 0043) -- so what is checked
 * is its kind, read the one way `@undercroft/contracts/sources` reads it. A suffix on a kind
 * that cannot hold a second account (`xero.3fa9c1d2e0ab`) reads as no kind at all and is sent
 * back like any other unknown source. The kind is handed down beside the source so the picker
 * never has to parse the URL a second time.
 */

import { sourceKind } from "@undercroft/contracts/sources";
import { Navigate, useParams } from "react-router-dom";

import { isSource } from "@/api/types.ts";
import { Book } from "@/components/Book.tsx";
import { ScopePicker } from "@/routes/ScopePicker.tsx";

export function ScopeRoute({ signedInAs }: { signedInAs: string }): React.JSX.Element {
  const params = useParams();
  const { tenantId, source } = params;

  if (!tenantId) {
    return <Navigate to="/tenants" replace={true} />;
  }
  const kind = sourceKind(source ?? "");
  if (source === undefined || !isSource(kind)) {
    return <Navigate to={`/tenants/${tenantId}`} replace={true} />;
  }

  return (
    <Book tenantId={tenantId} current="sources" signedInAs={signedInAs}>
      <ScopePicker tenantId={tenantId} source={source} kind={kind} />
    </Book>
  );
}
