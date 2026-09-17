# The ingestion/transformation worker.
#
# One image for all four sources plus the byte-path workers. There is no
# ingestion platform in this stack: dlt is a library inside this container, not a
# service, so "adding ingestion" adds exactly one container. See ADR 0003.
#
# Long-lived because Kestra invokes commands in it on a schedule; it does no work
# on its own.

FROM python:3.12-slim-bookworm

# curl for the healthcheck; postgresql-client for pg_dump/pg_restore, because
# backup runs HERE -- an image that can publish data but cannot back it up
# leaves the restore path untested until the day it is needed.
# Kept explicit so the image contents stay auditable rather than accumulating
# whatever a base image happens to ship.
# postgresql-client-17 specifically, from PGDG. Debian bookworm ships client
# 15, and pg_dump REFUSES to dump a newer server -- so the default package
# produces an image whose backup verb fails only when pointed at the real
# database. Pinned to the major version the compose stack runs.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
         -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
         > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-17 \
    && apt-get purge -y gnupg && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# Dependencies before source, so a code change does not re-resolve the whole
# dependency tree on every rebuild.
COPY requirements-dev.txt pyproject.toml ./
RUN pip install --no-cache-dir -r requirements-dev.txt

COPY vcdo/ ./vcdo/
# Migrations and flows are part of the deployable unit, not incidental files.
# The worker applies migrations, so an image without them is an image that
# cannot do its job -- and it fails at runtime, far from the missing COPY.
COPY migrations/ ./migrations/
COPY flows/ ./flows/
RUN pip install --no-cache-dir -e .

# Runs as a non-root user. The worker reads source APIs and writes to object
# storage; it has no reason to hold root in a container that handles customer
# data and credentials.
RUN useradd --create-home --uid 10001 vcdo \
    && mkdir -p /app/data \
    && chown -R vcdo:vcdo /app
USER vcdo

# `doctor` is a real check -- an S3 round trip and a SQL query -- not a liveness
# ping. A worker that is "up" but cannot reach the lake is not healthy in any
# sense that matters.
HEALTHCHECK --interval=60s --timeout=20s --start-period=30s --retries=3 \
    CMD python -m vcdo.cli.main doctor || exit 1

CMD ["sleep", "infinity"]
