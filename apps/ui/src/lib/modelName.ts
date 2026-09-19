/**
 * Whether a string can be a model's name: the contract's own rule, applied before the
 * request leaves the browser so a person is told at the field and not by a refusal.
 */

import { MODEL_NAME } from "@undercroft/contracts/models";

/** NAMEDATALEN - 1: the longest identifier Postgres keeps whole. */
const MAX_CHARS = 63;

export function isModelName(value: string): boolean {
  return value.length > 0 && value.length <= MAX_CHARS && MODEL_NAME.test(value);
}
