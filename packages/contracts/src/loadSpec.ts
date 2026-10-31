/**
 * Parse and validate a connector spec from YAML text.
 *
 * A parse failure names the path that failed, because "invalid connector" sends someone
 * to read the whole file while "entities.0.idPath: Invalid input: expected string, received
 * undefined" points at the line. The connector spec is the surface users author by hand, so
 * the path at the head of each message is part of the API. The sentence after it is the
 * spec's own where `connectorSpec.ts` words one, and otherwise Zod's, which is not ours to
 * promise: Zod 4 reworded every default (Zod 3 said "Required" here).
 */

import { parse as parseYaml } from "yaml";
import type { z } from "zod";
import { ConnectorSpec } from "./connectorSpec.ts";

export class SpecError extends Error {
  constructor(
    message: string,
    readonly issues: readonly string[] = [],
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "SpecError";
  }
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length === 0 ? "(root)" : issue.path.join(".");
    return `${path}: ${issue.message}`;
  });
}

export function parseSpec(text: string): ConnectorSpec {
  let tree: unknown;
  try {
    tree = parseYaml(text);
  } catch (error) {
    throw new SpecError(
      `connector spec is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
      [],
      { cause: error },
    );
  }

  const result = ConnectorSpec.safeParse(tree);
  if (!result.success) {
    const issues = formatIssues(result.error);
    throw new SpecError(`connector spec is invalid:\n  ${issues.join("\n  ")}`, issues);
  }
  return result.data;
}
