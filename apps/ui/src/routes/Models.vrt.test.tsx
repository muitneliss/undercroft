/**
 * The Models division as pictures: Demo Co.'s fourteen models listed with their build tally, and
 * the lineage view with one model's upstream chain lit -- on the board at 1440 px, and as the
 * names and paths a narrow screen reads instead of the board (ADR 0097).
 *
 * The fixtures mirror the design review's own (`@/test/modelsBook.ts`), so each capture is
 * reviewed beside the design's picture of the same screen; the reviewed capture is the baseline.
 * ADR 0099.
 */

import { describe, test as it } from "vitest";

import { modelsAnswers, TENANT } from "@/test/modelsBook.ts";
import { open } from "@/test/visual.tsx";

const MODELS = `/tenants/${TENANT}/models`;
const LINEAGE = `${MODELS}?view=lineage&model=`;

describe("the models list, in English, read by an admin", () => {
  it("at 1440 px", async () => {
    await open(MODELS, "en", modelsAnswers("admin")).matches("models-en-1440", 1440);
  });

  it("at 390 px", async () => {
    await open(MODELS, "en", modelsAnswers("admin")).matches("models-en-390", 390);
  });
});

describe("the lineage of customer_health_daily, in English", () => {
  it("on the board at 1440 px", async () => {
    await open(`${LINEAGE}customer_health_daily`, "en", modelsAnswers("admin")).matches(
      "lineage-en-1440",
      1440,
    );
  });

  it("as names at 390 px", async () => {
    await open(`${LINEAGE}customer_health_daily`, "en", modelsAnswers("admin")).matches(
      "lineage-en-390",
      390,
    );
  });
});

describe("the lineage of churn_watch, which refs a deleted model, in English", () => {
  it("as names and paths at 390 px", async () => {
    await open(`${LINEAGE}churn_watch`, "en", modelsAnswers("admin")).matches(
      "lineage-missing-en-390",
      390,
    );
  });
});
