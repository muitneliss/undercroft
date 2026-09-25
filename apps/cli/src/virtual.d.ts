/**
 * The platform's surface as `scripts/build.ts` bakes it into the bundle, served as the module
 * `virtual:surface`: the manifest the control plane's `procedureManifest()` walks off the
 * router, and the control plane's map from a tRPC error code to the CLI's. `tsconfig.json` maps
 * that specifier here, so the compiler and Biome read this declaration; the bundler's plugin
 * supplies the value.
 *
 * Data rather than an import, because the CLI's source may not import the control plane by
 * value (`.ast-grep/rules/cli-boundary.yml`, ADR 0044): what it ships holds no router code.
 *
 * It exists only inside a build: the CLI runs as its bundle, never from source, which is why
 * `task dev:cli` builds before it runs.
 */

import type { ErrorCodeTable, ProcedureSpec } from "./manifest.ts";

export declare const PROCEDURES: readonly ProcedureSpec[];

export declare const BY_TRPC_CODE: ErrorCodeTable;
