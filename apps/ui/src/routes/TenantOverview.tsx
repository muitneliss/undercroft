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

// biome-ignore-all lint/performance/useSolidForComponent: Solid-domain rule: it wants Solid's `<For>`, which does not exist in React. `Array#map` is how React renders a list.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for it makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off.

import { useTranslation } from "react-i18next";

import { Errata } from "@/components/Errata.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { trpc } from "@/trpc.ts";

export function TenantOverview({
  tenantId,
}: {
  tenantId: string;
  scopeFor?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const connections = trpc.connections.list.useQuery({ tenantId });

  if (connections.isPending) {
    return <Skeleton rows={5} />;
  }

  if (connections.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("sources.notLoaded")}
      </Errata>
    );
  }

  const list = connections.data;

  return (
    <div className="sheet">
      <div className="head head--division">{t("nav.sources")}</div>
      <div className="body stack">
        <h1>{t("sources.title")}</h1>
        <p className="prose prose--lead">
          {list.length === 0 ? t("sources.none") : t("sources.count", { count: list.length })}
        </p>
      </div>

      <div className="band-rule" />

      <div className="head">{t("sources.grantsHead")}</div>
      <div className="body">
        {list.length === 0 ? (
          <p className="note">{t("common.nothingToShow")}</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t("sources.colSource")}</th>
                <th scope="col">{t("sources.colStatus")}</th>
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

        <p className="note">{t("sources.notWired")}</p>
      </div>
    </div>
  );
}
