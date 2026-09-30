/**
 * One question as pictures: "Monthly revenue", read by a viewer on its drawing and on how it is
 * defined -- a question built in the form, which a viewer may not ask the server to compile --
 * and turned to the two-leaf workbench by an author, on a wide screen and a narrow one.
 *
 * The dashboard's month range rides in the address, as it does when a tile's title opens the
 * question. The fixtures mirror the design review's own (`@/test/reportsBook.ts`). ADR 0099.
 */

import { describe, test as it } from "vitest";

import { TENANT } from "@/test/modelsBook.ts";
import { PERFORMANCE_RANGE, QUESTION_ID, reportsAnswers } from "@/test/reportsBook.ts";
import { open } from "@/test/visual.tsx";

const QUESTION = `/tenants/${TENANT}/reports/questions/${QUESTION_ID.revenue}?${PERFORMANCE_RANGE}`;

describe("the question, in English, read by a viewer at 1440 px", () => {
  it("on its drawing", async () => {
    await open(`${QUESTION}&view=chart`, "en", reportsAnswers("viewer")).matches(
      "question-chart-viewer-en-1440",
      1440,
    );
  });

  it("on its definition", async () => {
    await open(`${QUESTION}&view=definition`, "en", reportsAnswers("viewer")).matches(
      "question-definition-viewer-en-1440",
      1440,
    );
  });
});

describe("the question's workbench, in English, opened by an admin", () => {
  it("at 1440 px", async () => {
    await open(`${QUESTION}&edit=1`, "en", reportsAnswers("admin")).matches(
      "question-edit-en-1440",
      1440,
    );
  });

  it("at 390 px", async () => {
    await open(`${QUESTION}&edit=1`, "en", reportsAnswers("admin")).matches(
      "question-edit-en-390",
      390,
    );
  });
});
