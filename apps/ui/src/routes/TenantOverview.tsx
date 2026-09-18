/**
 * The sources division: the schedule of standing grants.
 *
 * The schedule IS the product — the screen a new customer lands on is the one an established
 * one uses. It reads the real grants from `trpc.connections.list`, whose query is also the
 * visibility boundary for this tenant.
 *
 * The connect / scope / disconnect / run actions the fuller design carries are not wired
 * here yet: the control-plane router exposes `connections.list` and `connections.startOAuth`
 * but no disconnect, no scope-config write, and no tenant-wide run — and the connection
 * record it returns is the thin `{ source, status }` shape, not the rich grant-health view
 * model those actions need. So this shows the grants honestly and says what is not yet
 * actionable, rather than rendering buttons that post nowhere.
 */

// biome-ignore-all lint/style/noJsxLiterals: This would move all 77 pieces of UI copy into constants declared away from the markup that gives them meaning. That trade is worth making when a translation layer needs a key for every string; this app has none, so it buys nothing and costs the ability to read a component and see what it says.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.

// biome-ignore-all lint/nursery/noReactNativeRawText: React Native rule: it requires text to sit inside a <Text> component, because RN has no text nodes. This is a web React app rendering to the DOM, where a string inside a <p> is exactly right. On under reactNative: all in biome.jsonc, suppressed where it does not apply.

// biome-ignore-all lint/performance/useSolidForComponent: Solid-domain rule: it wants Solid's `<For>`, which does not exist in React. `Array#map` is how React renders a list.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for this rule makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off globally.

import { Errata } from "@/components/Errata.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { formatCount } from "@/lib/money.ts";
import { trpc } from "@/trpc.ts";

export function TenantOverview({
  tenantId,
}: {
  tenantId: string;
  scopeFor?: string;
}): React.JSX.Element {
  const connections = trpc.connections.list.useQuery({ tenantId });

  if (connections.isPending) {
    return <Skeleton rows={5} />;
  }

  if (connections.isError) {
    return (
      <Errata heading="Not loaded" live={true}>
        This customer’s grants could not be loaded, or you do not have access to them. Nothing has
        been changed.
      </Errata>
    );
  }

  const list = connections.data;

  return (
    <div className="sheet">
      <div className="head head--division">Sources</div>
      <div className="body stack">
        <h1>Connected sources</h1>
        <p className="prose prose--lead">
          {list.length === 0
            ? "No sources are connected for this customer yet."
            : `${formatCount(list.length)} ${list.length === 1 ? "source" : "sources"} on record.`}
        </p>
      </div>

      <div className="band-rule" />

      <div className="head">Grants</div>
      <div className="body">
        {list.length === 0 ? (
          <p className="note">Nothing to show.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.source}>
                  <td>{c.source}</td>
                  <td className="datum datum--quiet">{c.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="note">
          Connecting, scoping, disconnecting and running a sync from here are not wired yet — the
          control plane exposes the grant list but not those actions. Each source syncs on its own
          schedule in the meantime.
        </p>
      </div>
    </div>
  );
}
