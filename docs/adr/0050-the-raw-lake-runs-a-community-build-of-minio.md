# 50. The raw lake runs a community build of MinIO

- Status: Accepted
- Date: 2026-09-24

## Context

The raw lake is MinIO, run from `quay.io/minio/minio` with `quay.io/minio/mc` beside it for
the healthcheck and the bucket bootstrap. MinIO stopped publishing community images in 2025
and has since withdrawn them: in September 2026 both repositories answer 401 on quay.io and
"object not found" on Docker Hub, and Google's Docker Hub mirror no longer holds the pinned
tags. The v1.27.0 and v1.27.1 deploys failed at `--pull always` with `unauthorized`. The host
kept serving v1.26.0 on its cached image, but no release could reach it, and a fresh
development stack could not start.

Raw is the only durable layer (rule 1 in `CLAUDE.md`), and its bytes live in the `minio-data`
volume in MinIO's on-disk format. Whatever replaces the image must read that volume as it is.

## Decision

Both compose files run **`pgsty/minio`** and **`pgsty/mc`**, the community builds of MinIO's
own source published on Docker Hub, pinned by release tag
(`RELEASE.2026-08-04T00-00-00Z` and `RELEASE.2026-09-16T00-00-00Z`), each with a linux/amd64
build.

Checked before the change:

- The `minio` image carries `mc`, so the healthcheck `mc ready local` is unchanged. The `mc`
  image carries `/bin/sh`, so `minio-init`'s entrypoint is unchanged.
- An object written by the old `RELEASE.2025-09-07` server was read back from the same volume
  by the new server, with the same ETag and bytes, and no errors in the server log.
- `docker compose up --wait minio minio-init` from the development file: `minio` healthy,
  `minio-init` exited 0 after creating the bucket.

## Consequences

- The lake's server is now a third party's build of MinIO's code rather than MinIO's own. It
  is pinned by tag, so a change reaches the host only through a change to this repo.
- Upgrading means moving the tag, like any other upstream image here. An upgrade that
  changes the on-disk format has to be checked against a copy of the volume first, the way
  this one was.
- If this build stops too, the two options below are still open, and this ADR is where to
  start.

## Options rejected

- **Build MinIO from source into `ghcr.io/muitneliss`.** It gives full control, but it adds a
  Go build and security upkeep to a repo that is TypeScript only and builds two images.
  Worth revisiting if the community build goes the way of the official one.
- **Move to another S3 server (RustFS, SeaweedFS, Garage).** They are maintained, but none of
  them reads MinIO's on-disk format, so the whole raw lake would have to be copied across. A
  copy of the only durable layer is not a change to make just to get a deploy working again.
- **Keep the old image by not pulling it.** It would mean carving MinIO out of the command's
  `--pull always`, and the host's cached copy would be the only one left anywhere: pruning it
  or moving host would lose the image for good.
