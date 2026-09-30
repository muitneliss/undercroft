/**
 * One model open, as a picture: churn_watch, whose last build failed, with its facts row and the
 * Dependencies band -- where one of the models it refs has been deleted and is marked missing
 * rather than dropped (ADR 0077, 0092).
 *
 * The fixtures mirror the design review's own (`@/test/modelsBook.ts`). ADR 0099.
 */

import { describe, test as it } from "vitest";

import { modelsAnswers, TENANT } from "@/test/modelsBook.ts";
import { open } from "@/test/visual.tsx";

describe("the model editor, in English, read by an admin", () => {
  it("at 1440 px", async () => {
    await open(`/tenants/${TENANT}/models/churn_watch`, "en", modelsAnswers("admin")).matches(
      "model-editor-en-1440",
      1440,
    );
  });
});
