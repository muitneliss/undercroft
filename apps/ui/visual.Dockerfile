# check=skip=InvalidDefaultArgInFrom
#
# The machine the visual tier's baselines are taken on (ADR 0099).
#
# Microsoft's Playwright image, at exactly the Playwright version `apps/ui` pins: it carries the
# Chromium build that version drives and the fonts and libraries Chromium rasterises with, so a
# capture taken here on a Mac is the same bytes as one taken in CI. Bun is copied in at the
# version `.bun-version` pins, because the workspace is installed from `bun.lock`.
#
# Both versions are build arguments that `scripts/visual.ts` fills in from those two files, so
# bumping either pin moves this image with it. They have no defaults on purpose -- a default
# would be a third copy of a version -- which is the one BuildKit check skipped above.
ARG BUN_VERSION
ARG PLAYWRIGHT_VERSION

FROM oven/bun:${BUN_VERSION} AS bun

FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
