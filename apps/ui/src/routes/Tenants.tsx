/**
 * The customers division: the book's table of contents.
 *
 * A client belongs to one tenant and is routed straight past this screen -- a
 * list of one is a decision nobody needs to make. For staff it is the first
 * screen of the day, so it is a register: one line per member company, the
 * reference in mono where an operator's eye already looks for it, and the
 * status as a word.
 *
 * Every name here is a CASE-ID. `.claude/rules/pii.md` -- real client names live
 * only in restricted storage, never in a tracked file, a fixture or a
 * screenshot.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { api } from "@/api/client";
import { EmptyState } from "@/components/EmptyState";
import { Errata } from "@/components/Errata";
import { Plus } from "@/components/Icon";
import { Skeleton } from "@/components/Skeleton";
import { formatCount } from "@/lib/money";
import { formatDate } from "@/lib/when";

export function Tenants() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");

  const tenants = useQuery({ queryKey: ["tenants"], queryFn: () => api.tenants() });

  const create = useMutation({
    mutationFn: () => api.createTenant(name.trim()),
    onSuccess: async () => {
      setName("");
      await queryClient.invalidateQueries({ queryKey: ["tenants"] });
    },
  });

  if (tenants.isPending) return <Skeleton rows={4} />;

  if (tenants.isError) {
    return (
      <Errata heading="Not loaded" live>
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
                <th scope="col">Status</th>
                <th scope="col">Added</th>
              </tr>
            </thead>
            <tbody>
              {list.map((tenant) => (
                <tr key={tenant.id}>
                  <td>
                    <Link to={`/tenants/${tenant.id}`}>{tenant.display_name}</Link>
                  </td>
                  <td className="datum datum--quiet">{tenant.id}</td>
                  <td>{tenant.status}</td>
                  <td className="datum datum--quiet">{formatDate(tenant.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="band-rule" />

      <div className="head">Add</div>
      <div className="body">
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <div className="field" style={{ maxWidth: "24rem" }}>
            <label className="label" htmlFor="tenant-name">
              New customer
            </label>
            <input
              id="tenant-name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="CASE-XXXXXX"
              aria-describedby="tenant-name-hint"
            />
            <span id="tenant-name-hint" className="field__hint">
              Use the case reference, not the company’s real name. Real names are held only in
              restricted storage.
            </span>
          </div>

          {create.isError ? (
            <Errata heading="Not added" live>
              That customer could not be added. Nothing has been created.
            </Errata>
          ) : null}

          <div className="row">
            <button
              className="plate plate--primary"
              type="submit"
              disabled={!name.trim() || create.isPending}
            >
              {create.isPending ? "Adding…" : "Add customer"}
              {create.isPending ? null : <Plus size={13} />}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
