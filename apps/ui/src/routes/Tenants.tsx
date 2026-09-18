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

// biome-ignore-all lint/style/noJsxLiterals: This would move all 77 pieces of UI copy into constants declared away from the markup that gives them meaning. That trade is worth making when a translation layer needs a key for every string; this app has none, so it buys nothing and costs the ability to read a component and see what it says.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.

// biome-ignore-all lint/nursery/noReactNativeRawText: React Native rule: it requires text to sit inside a <Text> component, because RN has no text nodes. This is a web React app rendering to the DOM, where a string inside a <p> is exactly right. On under reactNative: all in biome.jsonc, suppressed where it does not apply.

// biome-ignore-all lint/performance/useSolidForComponent: Solid-domain rule: it wants Solid's `<For>`, which does not exist in React. `Array#map` is how React renders a list.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for this rule makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off globally.

import { Link } from "react-router-dom";

import { EmptyState } from "@/components/EmptyState.tsx";
import { Errata } from "@/components/Errata.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { formatCount } from "@/lib/money.ts";
import { trpc } from "@/trpc.ts";

export function Tenants(): React.JSX.Element {
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
