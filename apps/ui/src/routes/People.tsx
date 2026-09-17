/**
 * The people division: who may see this customer, and how they were invited.
 *
 * The membership and invitation endpoints are not part of the control-plane router yet, so
 * this is an honest placeholder in the design's idiom rather than a table wired to nothing.
 * The full roster — members, roles, and single-use invitations — lands when those procedures
 * exist. The `tenantId` is accepted now so the route and the tab rail are already in place.
 */

import { EmptyState } from "@/components/EmptyState";

export function People({ tenantId }: { tenantId: string }) {
  return (
    <div className="sheet">
      <div className="head head--division">People</div>
      <div className="body stack">
        <h1>People</h1>
        <p className="prose prose--lead">Who may see {tenantId}, and how they were invited.</p>
        <EmptyState
          title="Not available yet"
          body="Managing members and invitations needs endpoints the control plane does not expose yet. This section is in place for when it does."
        />
      </div>
    </div>
  );
}
