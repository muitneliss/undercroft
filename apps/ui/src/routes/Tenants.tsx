/**
 * The customers division: the book's table of contents.
 *
 * One line per member company, the reference in mono where an operator's eye already looks
 * for it, and the role as a word. The list comes from `trpc.tenants.list`, whose query IS
 * the visibility boundary -- it returns only tenants the caller is a member of.
 *
 * Every name here is a CASE-ID. `.claude/rules/pii.md` -- real client names live only in
 * restricted storage, never in a tracked file, a fixture or a screenshot.
 *
 * Adding a customer has no endpoint yet (the control-plane router exposes no create), so the
 * "Add" affordance is a plain note rather than a form that would post nowhere.
 */

import { Link } from "react-router-dom";

import { EmptyState } from "@/components/EmptyState.tsx";
import { Errata } from "@/components/Errata.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { formatCount } from "@/lib/money.ts";
import { trpc } from "@/trpc.ts";

export function Tenants() {
  const tenants = trpc.tenants.list.useQuery();

  if (tenants.isPending) {
    return <Skeleton rows={4} />;
  }

  if (tenants.isError) {
    return (
      <Errata heading="Not loaded" live={true}>
        The list of customers could not be loaded. Nothing has been changed.
      </Errata>
    );
  }

  const list = tenants.data;

  return (
    <div className="sheet">
      <div className="head head--division">Customers</div>
      <div className="body stack">
        <h1>Member companies</h1>
        <p className="prose prose--lead">
          Each customer’s data is stored and accessed separately. Open one to grant, scope or
          withdraw access to their accounts.
        </p>

        {list.length === 0 ? (
          <EmptyState
            title="No customers yet"
            body="A customer is the unit everything else hangs off: their connected accounts, their synced records, and who can see them."
          />
        ) : (
          <table className="table">
            <caption>
              {formatCount(list.length)} {list.length === 1 ? "customer" : "customers"}
            </caption>
            <thead>
              <tr>
                <th scope="col">Customer</th>
                <th scope="col">Reference</th>
                <th scope="col">Your role</th>
              </tr>
            </thead>
            <tbody>
              {list.map((tenant) => (
                <tr key={tenant.id}>
                  <td>
                    <Link to={`/tenants/${tenant.id}`}>{tenant.displayName || tenant.id}</Link>
                  </td>
                  <td className="datum datum--quiet">{tenant.id}</td>
                  <td>{tenant.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="band-rule" />

      <div className="head">Add</div>
      <div className="body">
        <p className="note">
          Adding a customer isn’t available here yet — the control plane exposes no create endpoint.
          Tenants are provisioned out of band for now.
        </p>
      </div>
    </div>
  );
}
