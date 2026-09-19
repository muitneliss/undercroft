# Shipped map boundaries

The region maps in the Reports division draw from the two files beside this note. They
are served from this origin as static assets; no tile server and no request to anyone
else is involved in drawing a map. Both are TopoJSON, WGS 84.

## `world-110m.json`

Countries of the world at 1:110m scale.

- **Source:** [Natural Earth](https://www.naturalearthdata.com/), via the
  [`world-atlas`](https://github.com/topojson/world-atlas) package, version 2.0.2, file
  `countries-110m.json`, copied verbatim.
- **Licence:** Natural Earth data is in the public domain. The `world-atlas` package's own
  files carry the ISC licence (copyright 2013–2019 Michael Bostock).
- **Keys:** each country's `id` is its ISO 3166-1 numeric code as a string; `properties.name`
  is Natural Earth's English short name.
- **Derivation:** none. `scripts/geo/world.ts` copies the file from the pinned package.

## `vn-provinces-2025.json`

The 34 provinces and centrally governed cities of Vietnam after the 2025 mergers.

- **Source:** the GeoJSON export of
  [`vietnamese-provinces-database`](https://github.com/ThangLeQuoc/vietnamese-provinces-database)
  by Thang Le Quoc, files `json/geojson/<code>_<name>/<code>_<name>.geojson`, at commit
  `92c0af2c234880639e356172ef9596b724b0ea25`. That project's boundaries are derived from
  the Vietnam Administrative Units Reference Map (`sapnhap.bando.com.vn`), published by the
  Vietnam Natural Resources, Environment and Cartography Publishing House under the
  Ministry of Agriculture and Environment.
- **Licence:** MIT (copyright 2021 Thang Le Quoc). The terms of the underlying reference
  map are the publishing house's; this repository records the derivation and does not
  claim more than the dataset it took the boundaries from.
- **Keys:** each province's `id` and `properties.code` is its official two-digit province
  code (`01` Hà Nội, `79` Hồ Chí Minh, `92` Cần Thơ); `properties.name` is the Vietnamese
  name with diacritics, `properties.nameEn` the English one. A question joins on the code
  or on either name, diacritics folded.
- **Derivation:** `scripts/geo/vnProvinces.ts` fetches the 34 files at the pinned commit,
  keeps only `code`, `name` and `nameEn`, joins them into one topology so shared borders
  are shared arcs, simplifies (Visvalingam, topology-preserving, the gentlest weight that
  brings the file under 200 kB) and quantizes to a 10 000-unit grid. Neighbours still
  meet; no province vanishes; the coastline is coarser than the source.

## Regenerating

```sh
bun run geo:build
```

Both scripts are deterministic against their pinned inputs. Moving the commit or the
package version is a deliberate change: update the pin in the script and the notes above
in the same commit.
