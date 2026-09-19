/**
 * The scope picker's frame: the book opened at the sources division for one source.
 *
 * Its own component rather than an `Opened` child because the source in the URL is a value
 * from outside and is checked before anything reads it: an unknown one sends the reader back
 * to the customer's own page rather than opening a picker for a source that does not exist.
 */

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
  if (!isSource(source)) {
    return <Navigate to={`/tenants/${tenantId}`} replace={true} />;
  }

  return (
    <Book tenantId={tenantId} current="sources" signedInAs={signedInAs}>
      <ScopePicker tenantId={tenantId} source={source} />
    </Book>
  );
}
