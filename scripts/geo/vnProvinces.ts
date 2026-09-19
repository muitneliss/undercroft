/**
 * Vietnam's 34 provinces as one TopoJSON, for the Reports division's region map.
 *
 * Source: the GeoJSON export of the MIT-licensed `vietnamese-provinces-database` (Thang Le
 * Quoc), whose boundaries are derived from the Vietnam Administrative Units Reference Map
 * (`sapnhap.bando.com.vn`, the Natural Resources, Environment and Cartography Publishing
 * House under the Ministry of Agriculture and Environment). WGS 84. One file per province,
 * keyed by the official province code, fetched at a PINNED commit so a rerun produces the
 * same bytes.
 *
 * What this does to them: keeps each province's code and names, drops everything else,
 * joins the 34 into one topology (shared borders become shared arcs), simplifies with
 * Visvalingam weights until the whole file is under the size budget, and quantizes. The
 * budget is what keeps a map from costing more than the chart library it rides with. The
 * simplification is topology-preserving: neighbours still meet, and no province vanishes.
 *
 * Regenerate with `bun run geo:build`; the provenance is in `apps/ui/public/geo/README.md`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { quantize } from "topojson-client";
import { topology } from "topojson-server";
import { presimplify, simplify } from "topojson-simplify";
import type { Objects, Topology } from "topojson-specification";

/** The commit the boundaries were taken from. Move it deliberately, with a README change. */
const COMMIT = "92c0af2c234880639e356172ef9596b724b0ea25";
const REPO = "ThangLeQuoc/vietnamese-provinces-database";

/** `<code>_<codeName>`, one per province, as the repository names its folders. */
const PROVINCES = [
  "01_ha_noi",
  "04_cao_bang",
  "08_tuyen_quang",
  "11_dien_bien",
  "12_lai_chau",
  "14_son_la",
  "15_lao_cai",
  "19_thai_nguyen",
  "20_lang_son",
  "22_quang_ninh",
  "24_bac_ninh",
  "25_phu_tho",
  "31_hai_phong",
  "33_hung_yen",
  "37_ninh_binh",
  "38_thanh_hoa",
  "40_nghe_an",
  "42_ha_tinh",
  "44_quang_tri",
  "46_hue",
  "48_da_nang",
  "51_quang_ngai",
  "52_gia_lai",
  "56_khanh_hoa",
  "66_dak_lak",
  "68_lam_dong",
  "75_dong_nai",
  "79_ho_chi_minh",
  "80_tay_ninh",
  "82_dong_thap",
  "86_vinh_long",
  "91_an_giang",
  "92_can_tho",
  "96_ca_mau",
] as const;

/** The most bytes the shipped file may be. */
const BUDGET_BYTES = 200 * 1024;
/** Visvalingam weights to try, gentlest first; the first under budget wins. */
const WEIGHTS = [1e-8, 3e-8, 1e-7, 3e-7, 1e-6, 3e-6, 1e-5, 3e-5, 1e-4];
const QUANTIZATION = 1e4;

interface ProvinceProperties {
  readonly code: string;
  readonly name: string;
  readonly nameEn: string;
}

interface SourceProperties {
  readonly code?: unknown;
  readonly name?: unknown;
  readonly nameEn?: unknown;
}

function text(value: unknown, what: string): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`${what} is missing`);
  }
  return value;
}

async function fetchProvince(
  folder: string,
): Promise<Feature<Polygon | MultiPolygon, ProvinceProperties>> {
  const url = `https://raw.githubusercontent.com/${REPO}/${COMMIT}/json/geojson/${folder}/${folder}.geojson`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${folder}: ${String(response.status)} from ${url}`);
  }
  const collection = (await response.json()) as FeatureCollection<
    Polygon | MultiPolygon,
    SourceProperties
  >;
  const [feature] = collection.features;
  if (feature === undefined) {
    throw new Error(`${folder}: no feature`);
  }
  const code = text(feature.properties.code, `${folder} code`);
  return {
    type: "Feature",
    id: code,
    geometry: feature.geometry,
    properties: {
      code,
      name: text(feature.properties.name, `${folder} name`),
      nameEn: text(feature.properties.nameEn, `${folder} nameEn`),
    },
  };
}

function bytesOf(topo: Topology): number {
  return Buffer.byteLength(JSON.stringify(topo), "utf8");
}

const features: Feature<Polygon | MultiPolygon, ProvinceProperties>[] = [];
for (const folder of PROVINCES) {
  features.push(await fetchProvince(folder));
  process.stdout.write(`fetched ${folder}\n`);
}
if (features.length !== PROVINCES.length) {
  throw new Error(`expected ${String(PROVINCES.length)} provinces, got ${String(features.length)}`);
}

const collection: FeatureCollection<Polygon | MultiPolygon, ProvinceProperties> = {
  type: "FeatureCollection",
  features,
};
const built = topology({ provinces: collection }) as Topology<Objects<ProvinceProperties>>;
const full = presimplify(built);
let chosen: Topology | null = null;
for (const weight of WEIGHTS) {
  const candidate = quantize(simplify(full, weight), QUANTIZATION);
  const size = bytesOf(candidate);
  process.stdout.write(`weight ${String(weight)}: ${String(size)} bytes\n`);
  if (size <= BUDGET_BYTES) {
    chosen = candidate;
    break;
  }
}
if (chosen === null) {
  throw new Error(`no simplification weight brought the file under ${String(BUDGET_BYTES)} bytes`);
}

const targetDir = new URL("../../apps/ui/public/geo/", import.meta.url);
const target = new URL("vn-provinces-2025.json", targetDir);
mkdirSync(targetDir, { recursive: true });
writeFileSync(target, JSON.stringify(chosen));
process.stdout.write(
  `wrote ${fileURLToPath(target)} (${String(bytesOf(chosen))} bytes, ${String(features.length)} provinces)\n`,
);
