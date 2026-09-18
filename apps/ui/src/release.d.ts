/**
 * The build-time release stamp.
 *
 * Replaced literally by Vite's `define` (see `vite.config.ts`) and set on `globalThis` by
 * `src/test/setup.ts` for `bun test`. Declared here rather than beside its reader so there
 * is exactly one declaration of it; `@/lib/release` is the only module that may name it.
 */
declare const __UNDERCROFT_RELEASE__: string;
