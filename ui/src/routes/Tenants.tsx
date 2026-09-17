/**
 * The tenant picker, for staff.
 *
 * A client belongs to one tenant and is routed straight past this screen — a
 * list of one is a decision nobody needs to make.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { api } from "@/api/client";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";

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

  if (tenants.isPending) return <Skeleton rows={3} />;
  if (tenants.isError) {
    return (
      <p className="error-text" role="alert">
        Could not load tenants.
      </p>
    );
  }

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h2>Customers</h2>
          <p className="page-header__sub">
            Each customer’s data is stored and accessed separately.
          </p>
        </div>
      </div>

      {tenants.data.length === 0 ? (
        <EmptyState
          title="No customers yet"
          body="A customer is the unit everything else hangs off: their connected accounts, their synced records, and who can see them."
        />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Customer</th>
              <th scope="col">Reference</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {tenants.data.map((tenant) => (
              <tr key={tenant.id}>
                <td>
                  <Link to={`/tenants/${tenant.id}`}>{tenant.display_name}</Link>
                </td>
                <td className="mono">{tenant.id}</td>
                <td>{tenant.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form
        className="card row"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <div className="field" style={{ flex: 1 }}>
          <label className="field__label" htmlFor="tenant-name">
            Add a customer
          </label>
          <input
            id="tenant-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Customer name"
          />
        </div>
        <button className="btn btn--primary" type="submit" disabled={!name.trim() || create.isPending}>
          {create.isPending ? "Adding…" : "Add"}
        </button>
      </form>
    </div>
  );
}
