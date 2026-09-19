/**
 * How a model's last build reads on the list: the same four marks the grants use, so a
 * column of models scans the way a column of sources does.
 *
 * dbt's statuses for a model node are `success`, `error` and `skipped`; a model never built
 * has none. Anything dbt adds later that this does not know is pending rather than
 * guessed at as a success.
 */

import type { TFunction } from "i18next";

import type { CardFacts } from "@/lib/connectionState.ts";

export function buildMark(status: string | null): CardFacts["mark"] {
  switch (status) {
    case "success":
      return "granted";
    case "error":
      return "lapsed";
    case null:
      return "absent";
    default:
      return "pending";
  }
}

export function buildMarkLabel(t: TFunction, status: string | null): string {
  switch (status) {
    case "success":
      return t("models.buildOk");
    case "error":
      return t("models.buildFailed");
    case null:
      return t("models.neverBuilt");
    default:
      return t("models.buildOther", { status });
  }
}
