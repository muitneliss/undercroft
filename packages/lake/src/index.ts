// biome-ignore-all lint/performance/noBarrelFile: `index.ts` is each package's public entry point, which is the seam `.claude/rules/layering.md` is built on and what `.claude/rules/tests.md` means by testing through the public API. The re-export cost the rule is about applies to a bundle; these are workspace packages consumed by name.

export { InMemoryObjectStore } from "./memory.ts";
export { ObjectNotFound, type ObjectStore } from "./objectStore.ts";
export { S3ObjectStore, type S3StoreConfig } from "./s3.ts";
export {
  type JournalEntry,
  LakeStore,
  type LakeStoreOptions,
  ObjectExists,
  type PutResult,
  RETENTION_UNBOUNDED,
  sha256Hex,
} from "./store.ts";
