/**
 * Registers happy-dom globally so React can render in `bun test`. Preloaded via
 * bunfig.toml, so every UI test gets a document without importing this itself.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
