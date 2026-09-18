/**
 * The raw lake division: what has actually landed.
 *
 * Browsing the raw lake — objects, their provenance manifests, and admin-only downloads —
 * needs endpoints the control-plane router does not expose yet, so this is an honest
 * placeholder in the design's idiom rather than a browser wired to nothing. It lands when
 * those procedures exist. The `tenantId` is accepted now so the route and tab rail are
 * already in place.
 */

import { EmptyState } from "@/components/EmptyState.tsx";

export function Lake({ tenantId }: { tenantId: string }) {
  return (
    <div className="sheet">
      <div className="head head--division">Lake</div>
      <div className="body stack">
        <h1>Raw lake</h1>
        <p className="prose prose--lead">
          What has actually landed for {tenantId}, before any transform.
        </p>
        <EmptyState
          title="Not available yet"
          body="Browsing lake objects and their provenance needs endpoints the control plane does not expose yet. This section is in place for when it does."
        />
      </div>
    </div>
  );
}
