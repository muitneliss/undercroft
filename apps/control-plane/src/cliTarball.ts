/**
 * The CLI tarball the image carries, read once at boot, for `/cli/undercroft-cli.tgz` to serve.
 * ADR 0135.
 *
 * The image packs it from its own sources with `apps/cli/scripts/pack.ts`, the script every
 * release packs with, and names it in `UNDERCROFT_CLI_TARBALL` -- so the CLI a person installs
 * from a server is built from that server's commit and lists that server's procedures. A process
 * started from a checkout names none and serves none: a tarball lying in `apps/cli/dist` from
 * some earlier `task build:cli-pack` is never picked up, because it need not match this server.
 *
 * Read into memory rather than streamed from disk per request: it is a few hundred kilobytes,
 * and the handler then serves bytes it was given instead of reaching the filesystem itself.
 *
 * Fails soft, like the skills and the widgets: a file that cannot be read is logged and the
 * route answers 404, and the server still boots. The image's build refuses to finish without the
 * file, so this guards a container started from something else.
 */

import { readFileSync } from "node:fs";
import { describeError, type Logger } from "@undercroft/core";

/** The tarball's bytes, or none -- logged either way -- so a missing file never stops the boot. */
export function loadCliTarball(
  log: Logger,
  path: string | undefined,
): Uint8Array<ArrayBuffer> | undefined {
  if (path === undefined) {
    log.info("cli_tarball_absent", {});
    return undefined;
  }
  try {
    const bytes = new Uint8Array(readFileSync(path));
    log.info("cli_tarball_loaded", { path, bytes: bytes.byteLength });
    return bytes;
  } catch (error) {
    log.error("cli_tarball_unloaded", { path, ...describeError(error) });
    return undefined;
  }
}
