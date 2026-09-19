/**
 * A region map: the question's rows coloured onto shipped boundaries.
 *
 * The boundaries are static files on this origin (`public/geo/`, see the README beside
 * them): Vietnam's 34 provinces, or the world's countries. No tile server, no request to
 * anyone else. A row reaches its region by code or by a name in either language with the
 * accents folded (`lib/geoJoin.ts`), and the rows that reach none are listed under the map
 * rather than dropped, because a province left blank by an accent is the invisible
 * wrongness rule 2 exists to prevent.
 *
 * The fill is the sequential ramp of the palette; the figure in the tooltip is the row's
 * original digits, never the float that positioned the colour. Loaded lazily inside the
 * chart frame, so the geo plugin and the projection maths ride only with a map.
 */

// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: These are the functions that hold one decision each -- the connector page loop, the deploy poller, the grant migration -- and the way to shorten them is to split one sequential procedure across several names, which makes the order it happens in harder to follow rather than easier.
// biome-ignore-all lint/correctness/noSolidDestructuredProps: Solid-domain rule: destructuring props defeats Solid's reactivity, because there `props` is a proxy. React props are a plain object and destructuring them is the idiomatic form.
// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as useExplicitType above: what remains are contextually-typed callbacks whose inferred type is a Chart.js option shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- Chart.js's tooltip and scale callbacks -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/performance/noJsxPropsBind: Data and option objects built per render for a map of one result. The re-render the rule is about matters under a memoised list of hundreds.
// biome-ignore-all lint/style/noMagicNumbers: The number of unmatched labels named before "and more" is the number itself, read beside the note it bounds.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useNamingConvention: `ChartJS` is the name react-chartjs-2's own documentation gives the Chart.js class when both are in one file, to keep it apart from the `Chart` component; strictCase would have it `ChartJs`, which no reader of either library recognises.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for it makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off.

import { useQuery } from "@tanstack/react-query";
import type { ChartConfig } from "@undercroft/contracts/bi";
import { Chart as ChartJS } from "chart.js";
import { ChoroplethController, ColorScale, GeoFeature, ProjectionScale } from "chartjs-chart-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { Chart } from "react-chartjs-2";
import { useTranslation } from "react-i18next";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";

import type { TableResult } from "@/api/types.ts";
import { Errata } from "@/components/Errata.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { toSeries } from "@/lib/chartData.ts";
import { joinRegions, type Region, type RegionRow } from "@/lib/geoJoin.ts";
import { formatDecimal, MISSING } from "@/lib/money.ts";
import { sequential } from "@/lib/plotPalette.ts";

ChartJS.register(ChoroplethController, GeoFeature, ColorScale, ProjectionScale);

/** The two maps shipped, by the key `chart.options.region` names. */
const REGIONS = {
  vn: { url: "/geo/vn-provinces-2025.json", object: "provinces", projection: "mercator" },
  world: { url: "/geo/world-110m.json", object: "countries", projection: "equalEarth" },
} as const;

type RegionKey = keyof typeof REGIONS;

function regionOf(chart: ChartConfig): RegionKey {
  return chart.options.region === "world" ? "world" : "vn";
}

function isTopology(value: unknown): value is Topology {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "Topology" &&
    "objects" in value &&
    typeof value.objects === "object"
  );
}

async function loadTopology(url: string): Promise<Topology> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: ${String(response.status)}`);
  }
  const body: unknown = await response.json();
  if (!isTopology(body)) {
    throw new Error(`${url}: not a topology`);
  }
  return body;
}

/** A feature's key and names, from what the shipped files carry. */
function regionOfFeature(item: Feature<Geometry>): Region {
  const props = item.properties ?? {};
  const code = String(props.code ?? item.id ?? "");
  const names = [props.name, props.nameEn].filter((n): n is string => typeof n === "string");
  return { code, names };
}

function nameOf(item: Feature<Geometry>): string {
  const name = item.properties?.name;
  return typeof name === "string" ? name : String(item.id ?? "");
}

/** The sequential ramp as Chart.js's colour scale asks for it: a function of 0..1. */
const RAMP = sequential(6);
function interpolate(normalized: number): string {
  const at = Math.round(Math.min(1, Math.max(0, normalized)) * (RAMP.length - 1));
  return RAMP[at] ?? RAMP[0] ?? "#234c9e";
}

const NAMED_UNMATCHED = 8;

export function GeoChart({
  result,
  chart,
}: {
  result: TableResult;
  chart: ChartConfig;
}): React.JSX.Element {
  const { t } = useTranslation();
  const region = regionOf(chart);
  const spec = REGIONS[region];
  const topo = useQuery({
    queryKey: ["geo", region],
    queryFn: () => loadTopology(spec.url),
    staleTime: Number.POSITIVE_INFINITY,
  });

  if (topo.isPending) {
    return <Skeleton rows={6} />;
  }
  if (topo.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("chart.mapNotLoaded")}
      </Errata>
    );
  }
  const object = topo.data.objects[spec.object];
  if (object === undefined || object.type !== "GeometryCollection") {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("chart.mapNotLoaded")}
      </Errata>
    );
  }
  const collection: FeatureCollection<Geometry> = feature(topo.data, object);

  const series = toSeries(result, chart, t("chart.other"));
  const [first] = series.datasets;
  if (first === undefined) {
    return <p className="note">{t("chart.mapNeeds")}</p>;
  }
  const rows: RegionRow[] = series.labels.map((label, i) => ({
    label,
    value: first.values[i] ?? null,
    raw: first.raw[i] ?? null,
  }));
  const regions = collection.features.map(regionOfFeature);
  const joined = joinRegions(regions, rows);

  const points = collection.features.flatMap((item) => {
    const row = joined.byCode.get(regionOfFeature(item).code);
    return row === undefined || row.value === null ? [] : [{ feature: item, value: row.value }];
  });

  return (
    <div className="stack stack--tight">
      <div className="plot plot--map">
        <Chart
          type="choropleth"
          data={{
            labels: collection.features.map(nameOf),
            datasets: [
              {
                label: first.label,
                outline: collection.features,
                showOutline: true,
                data: points,
              },
            ],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: (item) => {
                    const point = points[item.dataIndex];
                    const row =
                      point === undefined
                        ? undefined
                        : joined.byCode.get(regionOfFeature(point.feature).code);
                    const name = point === undefined ? "" : nameOf(point.feature);
                    return `${name}: ${row?.raw === null || row === undefined ? MISSING : formatDecimal(row.raw)}`;
                  },
                },
              },
            },
            scales: {
              projection: { axis: "x", projection: spec.projection },
              color: { axis: "x", interpolate, legend: { position: "bottom-right" } },
            },
          }}
        />
      </div>
      {joined.unmatched.length > 0 ? (
        <p className="note">
          {t("chart.unmatched", {
            count: joined.unmatched.length,
            names: joined.unmatched.slice(0, NAMED_UNMATCHED).join(", "),
          })}
        </p>
      ) : null}
      <p className="field__hint">
        {region === "vn" ? t("chart.attributionVn") : t("chart.attributionWorld")}
      </p>
    </div>
  );
}
