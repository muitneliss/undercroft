/**
 * JSON checked at the edge. Both HubSpot's answers and the CLI's envelopes arrive as text; each
 * helper here names where it was reading when the shape is not the one expected, so a changed
 * API fails with a location rather than with a `TypeError` three calls later.
 */

/** One HubSpot record, as HubSpot answers it and as the lake keeps it in its payload. */
export interface CrmRecord {
  readonly id: string;
  readonly updatedAt: string;
  readonly archived: boolean;
  readonly properties: Readonly<Record<string, string | null>>;
}

export function objectAt(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${where}: expected an object`);
  }
  return Object.fromEntries(Object.entries(value));
}

export function arrayAt(value: unknown, where: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${where}: expected an array`);
  }
  return value;
}

export function textAt(value: unknown, where: string): string {
  if (typeof value !== "string") {
    throw new Error(`${where}: expected a string`);
  }
  return value;
}

export function parse(text: string, where: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${where}: the answer is not JSON`, { cause: error });
  }
}

/** A record in the shape HubSpot writes it. */
export function crmRecord(value: unknown, where: string): CrmRecord {
  const record = objectAt(value, where);
  const properties: Record<string, string | null> = {};
  for (const [name, raw] of Object.entries(objectAt(record.properties, `${where}.properties`))) {
    properties[name] = raw === null ? null : textAt(raw, `${where}.properties.${name}`);
  }
  return {
    id: textAt(record.id, `${where}.id`),
    updatedAt: textAt(record.updatedAt, `${where}.updatedAt`),
    archived: record.archived === true,
    properties,
  };
}
