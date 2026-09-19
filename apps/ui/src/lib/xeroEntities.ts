/**
 * The entities a Xero connection can be told to read, and their names in the reader's
 * language.
 *
 * The list mirrors `specs/connectors/xero.yaml` by hand: the interface does not read specs,
 * and an entity offered here that the spec does not declare would be a tick that reads
 * nothing. The ids stay as the spec names them -- they are what the choice records -- and
 * only the words a person sees are translated.
 */

// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useExportsLast: Reordering modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. That ordering carries meaning; the rule's preferred one does not.
// biome-ignore-all lint/style/useNamingConvention: `credit_notes` is the entity's id in the connector spec, and the id is what the choice records; a camelCase spelling would be a second name for the same thing.

import type { TFunction } from "i18next";

export type XeroEntity = "contacts" | "invoices" | "payments" | "credit_notes";

/** In the spec's order, which is the order the picker offers them. */
export const XERO_ENTITIES: readonly XeroEntity[] = [
  "contacts",
  "invoices",
  "payments",
  "credit_notes",
];

const ENTITY_KEY: Record<
  XeroEntity,
  "scope.xeroContacts" | "scope.xeroInvoices" | "scope.xeroPayments" | "scope.xeroCreditNotes"
> = {
  contacts: "scope.xeroContacts",
  invoices: "scope.xeroInvoices",
  payments: "scope.xeroPayments",
  credit_notes: "scope.xeroCreditNotes",
};

function isXeroEntity(value: string): value is XeroEntity {
  return XERO_ENTITIES.some((entity) => entity === value);
}

/** An entity's name for a reader; an id this build has no word for keeps its id. */
export function describeXeroEntity(t: TFunction, entity: string): string {
  return isXeroEntity(entity) ? t(ENTITY_KEY[entity]) : entity;
}
