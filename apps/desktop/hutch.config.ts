// @hutch cli=0.27.1 cottontail=0.7.1
/**
 * Hutch, Electrobun 2's build tool, pinned to the exact releases the `electrobun` npm package
 * 2.0.2 pairs with, so a build a year from now resolves the same toolchain (ADR 0097). Bun is the
 * package manager, as for the rest of the workspace: Hutch otherwise resolves dependencies itself
 * into a `hutch.lock`, a second lockfile beside `bun.lock` that would drift from it.
 */
export default {
  electrobun: { version: "2.0.2" },
  packageManager: "bun",
};
