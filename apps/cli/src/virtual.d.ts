/**
 * The manifest `scripts/build.ts` extracts from `appRouter` and serves to the bundle as the
 * module `virtual:procedures`. `tsconfig.json` maps that specifier here, so the compiler and
 * Biome read this declaration; the bundler's plugin supplies the value.
 *
 * It exists only inside a build: the CLI runs as its bundle, never from source, which is why
 * `task dev:cli` builds before it runs.
 */

import type { ProcedureSpec } from "./manifest.ts";

export declare const PROCEDURES: readonly ProcedureSpec[];
