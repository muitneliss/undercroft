---
title: 'ADR 0050: The raw lake runs a community build of MinIO'
type: source
date: 2026-09-24
tags: []
source: docs/adr/0050-the-raw-lake-runs-a-community-build-of-minio.md
source_path: docs/adr/0050-the-raw-lake-runs-a-community-build-of-minio.md
source_hash: 669782bbdbbd0d1966e5600b8fe5fc60bc82488b982b8ef54773c3e99f913526
ingested: 2026-09-24
---

# ADR 0050: The raw lake runs a community build of MinIO

Accepted 2026-09-24.

**Context.** The raw lake ran `quay.io/minio/minio` with `quay.io/minio/mc` for the healthcheck and bucket bootstrap. MinIO stopped publishing community images in 2025 and has since withdrawn them: both repositories answer 401 on quay.io and "object not found" on Docker Hub, and Google's Docker Hub mirror no longer holds the pinned tags. The v1.27.0 and v1.27.1 deploys failed at `--pull always` with `unauthorized`; the host kept serving v1.26.0 on its cached image, and a fresh development stack could not start. Raw is the only durable layer, and its bytes live in the `minio-data` volume in MinIO's on-disk format, so a replacement must read that volume as it is.

**Decision.** Both compose files run `pgsty/minio` and `pgsty/mc`, community builds of MinIO's own source on Docker Hub, pinned by release tag (`RELEASE.2026-08-04T00-00-00Z`, `RELEASE.2026-09-16T00-00-00Z`) with linux/amd64 builds. Checked first: the `minio` image carries `mc` (healthcheck `mc ready local` unchanged) and the `mc` image carries `/bin/sh` (`minio-init` unchanged); an object written by the old `RELEASE.2025-09-07` server was read back from the same volume by the new one with the same ETag and bytes and no server errors; and `docker compose up --wait minio minio-init` left `minio` healthy and `minio-init` exited 0 after creating the bucket.

**Consequences.** The lake's server is a third party's build of MinIO's code, pinned by tag so a change reaches the host only through this repo. An upgrade that changes the on-disk format must be checked against a copy of the volume first.

**Rejected.** Building MinIO from source into ghcr (a Go build and security upkeep in a TypeScript-only repo; revisit if the community build stops); moving to RustFS, SeaweedFS or Garage (none reads MinIO's format, so the whole raw lake would have to be copied); not pulling MinIO so the host keeps its cached copy (the only copy left anywhere, lost on a prune or a host move).
