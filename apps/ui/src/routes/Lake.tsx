/**
 * The raw lake division: what has actually landed.
 *
 * Browsing the raw lake — objects, their provenance manifests, and admin-only downloads —
 * needs endpoints the control-plane router does not expose yet, so this is an honest
 * placeholder in the design's idiom rather than a browser wired to nothing. It lands when
 * those procedures exist. The `tenantId` is accepted now so the route and tab rail are
 * already in place.
 */

// biome-ignore-all lint/nursery/noReactNativeRawText: React Native rule: it requires text to sit inside a <Text> component, because RN has no text nodes. This is a web React app rendering to the DOM, where a string inside a <p> is exactly right. On under reactNative: all in biome.jsonc, suppressed where it does not apply.

// biome-ignore-all lint/correctness/noSolidDestructuredProps: Solid-domain rule: destructuring props defeats Solid's reactivity, because there `props` is a proxy. React props are a plain object and destructuring them is the idiomatic form.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for this rule makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off globally.

import { EmptyState } from "@/components/EmptyState.tsx";

export function Lake({ tenantId }: { tenantId: string }): React.JSX.Element {
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
