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

import { Errata } from "@/components/Errata.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { formatCount } from "@/lib/money.ts";
import { trpc } from "@/trpc.ts";

export function TenantOverview({ tenantId }: { tenantId: string; scopeFor?: string }) {
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
