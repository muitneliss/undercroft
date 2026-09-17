/**
 * The raw lake division: what has actually landed.
 *
 * This is the layer the platform cannot recompute. Everything in Postgres is a
 * projection and may be dropped and rebuilt; these objects cannot be, which is
 * why the leaf says so at the top rather than leaving an operator to infer the
 * difference from a table of keys.
 *
 * WHAT A ROW IS. One row is a source key -- the thing a human browses -- and the
 * count beside it is how many times that key has been OBSERVED, not how many
 * copies exist. Writes are create-only and content-addressed, so an unchanged
 * file costs one manifest rather than one copy, and "3 observations" of an
 * unchanged object is the normal, healthy reading. Calling the column "versions"
 * without saying that invites exactly the wrong conclusion.
 *
 * THE DIGEST IS NOT DECORATION. `newest_sha256` is how a stored object is
 * identified and how corruption is caught on read, so it is shown in full on the
 * manifest leaf rather than truncated into something that looks like an ID but
 * cannot be compared against anything.
 *
 * DOWNLOADING IS AN ACT, NOT A GLANCE. The bytes are the customer's invoices and
 * email attachments. The endpoint is admin-only and writes to the audit log
 * server-side; the interface states that before the click, because a consequence
 * disclosed afterwards is not a disclosure.
 */

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "@/api/client";
import type { LakeObject } from "@/api/types";
import { EmptyState } from "@/components/EmptyState";
import { Errata } from "@/components/Errata";
import { ChevronDown, ChevronUp, Download } from "@/components/Icon";
import { Skeleton } from "@/components/Skeleton";
import { formatBytes, formatCount, orMissing } from "@/lib/money";
import { formatDateTime } from "@/lib/when";

function Manifests({ tenantId, objectKey }: { tenantId: string; objectKey: string }) {
  const manifests = useQuery({
    queryKey: ["lake-object", tenantId, objectKey],
    queryFn: () => api.lakeObject(tenantId, objectKey),
  });

  if (manifests.isPending) return <Skeleton rows={2} />;

  if (manifests.isError) {
    return (
      <Errata heading="Not loaded" live>
        The provenance for this object could not be read.
      </Errata>
    );
  }

  return (
    <div className="stack">
      <table className="table">
        <caption>Observations, oldest first</caption>
        <thead>
          <tr>
            <th scope="col">Observed</th>
            <th scope="col">Digest</th>
            <th scope="col">Reason</th>
            <th scope="col" className="num">
              Size
            </th>
            <th scope="col">
              <span className="visually-hidden">Bytes</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {manifests.data.versions.map((version) => (
            <tr key={version.stamp}>
              <td className="datum">{formatDateTime(version.observed_at)}</td>
              <td className="datum datum--quiet">{orMissing(version.sha256)}</td>
              <td className="datum datum--quiet">{orMissing(version.reason)}</td>
              <td className="datum num">{formatBytes(version.bytes)}</td>
              <td>
                <a
                  className="plate plate--small"
                  href={api.lakeDownloadUrl(tenantId, objectKey, version.stamp)}
                >
                  Download
                  <Download size={12} />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="note">
        Downloading is restricted to administrators and is written to the audit log against
        your name. These are the customer’s documents.
      </p>
    </div>
  );
}

export function Lake({ tenantId }: { tenantId: string }) {
  const [prefix, setPrefix] = useState("");
  const [applied, setApplied] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const objects = useQuery({
    queryKey: ["lake", tenantId, applied],
    queryFn: () => api.lake(tenantId, applied),
  });

  return (
    <div className="sheet">
      <div className="head head--division">Raw lake</div>
      <div className="body stack">
        <h1>What has landed</h1>
        <p className="prose prose--lead">
          This is the only layer that cannot be rebuilt. The curated tables behind the
          dashboards are projections of what is here and may be dropped and recreated at any
          time; these objects are written once and never overwritten.
        </p>

        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(prefix.trim());
          }}
        >
          <div className="field" style={{ minWidth: "18rem" }}>
            <label className="label" htmlFor="lake-prefix">
              Narrow to a prefix
            </label>
            <input
              id="lake-prefix"
              className="input"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="xero/"
              aria-describedby="lake-prefix-hint"
            />
            <span id="lake-prefix-hint" className="field__hint">
              Leave blank for everything stored for this customer.
            </span>
          </div>
          <button className="plate" type="submit">
            Show
          </button>
        </form>
      </div>

      <div className="band-rule" />

      <div className="head">Objects</div>
      <div className="body">
        {objects.isPending ? <Skeleton rows={5} /> : null}

        {objects.isError ? (
          <Errata heading="Not loaded" live>
            The lake could not be listed, or you do not have access to this customer.
          </Errata>
        ) : null}

        {objects.isSuccess && objects.data.length === 0 ? (
          <EmptyState
            title="Nothing stored yet"
            body={
              applied
                ? "No object under that prefix. Nothing has been deleted — the lake is create-only — so this means nothing has been written there."
                : "Once a source has been granted, scoped and synced, every record and document it read is written here and listed on this leaf."
            }
          />
        ) : null}

        {objects.isSuccess && objects.data.length > 0 ? (
          <table className="table">
            <caption>
              {formatCount(objects.data.length)}{" "}
              {objects.data.length === 1 ? "object" : "objects"}
            </caption>
            <thead>
              <tr>
                <th scope="col">Key</th>
                <th scope="col" className="num">
                  Observations
                </th>
                <th scope="col" className="num">
                  Newest size
                </th>
                <th scope="col">
                  <span className="visually-hidden">Provenance</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {objects.data.map((object: LakeObject) => {
                const isOpen = open === object.key;
                return (
                  <tr key={object.key}>
                    <td className="datum">
                      {object.key}
                      {isOpen ? (
                        <Manifests tenantId={tenantId} objectKey={object.key} />
                      ) : null}
                    </td>
                    <td className="datum num">{formatCount(object.versions)}</td>
                    <td className="datum num">{formatBytes(object.bytes)}</td>
                    <td>
                      <button
                        className="plate plate--small"
                        onClick={() => setOpen(isOpen ? null : object.key)}
                        aria-expanded={isOpen}
                      >
                        {isOpen ? "Hide" : "Provenance"}
                        {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}
