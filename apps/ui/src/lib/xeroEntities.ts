/**
 * The entities a Xero connection can be told to read, and their names in the reader's
 * language.
 *
 * The list mirrors `specs/connectors/xero.yaml` by hand: the interface does not read specs,
 * and an entity offered here that the spec does not declare would be a tick that reads
 * nothing. `xeroEntities.test.ts` holds the two to one list, in one order. The ids stay as the
 * spec names them -- they are what the choice records -- and only the words a person sees are
 * translated.
 */

import type { TFunction } from "i18next";

/** Each entity, and the catalogue key its name is under. In the spec's order. */
const ENTITY_KEY = {
  contacts: "scope.xeroContacts",
  invoices: "scope.xeroInvoices",
  payments: "scope.xeroPayments",
  credit_notes: "scope.xeroCreditNotes",
  quotes: "scope.xeroQuotes",
  purchase_orders: "scope.xeroPurchaseOrders",
  repeating_invoices: "scope.xeroRepeatingInvoices",
  linked_transactions: "scope.xeroLinkedTransactions",
  items: "scope.xeroItems",
  overpayments: "scope.xeroOverpayments",
  prepayments: "scope.xeroPrepayments",
  batch_payments: "scope.xeroBatchPayments",
  contact_groups: "scope.xeroContactGroups",
  accounts: "scope.xeroAccounts",
  tracking_categories: "scope.xeroTrackingCategories",
  tax_rates: "scope.xeroTaxRates",
  currencies: "scope.xeroCurrencies",
} as const;

export type XeroEntity = keyof typeof ENTITY_KEY;

function isXeroEntity(value: string): value is XeroEntity {
  return Object.hasOwn(ENTITY_KEY, value);
}

/** In the spec's order, which is the order the picker offers them. */
export const XERO_ENTITIES: readonly XeroEntity[] = Object.keys(ENTITY_KEY).filter(isXeroEntity);

/** An entity's name for a reader; an id this build has no word for keeps its id. */
export function describeXeroEntity(t: TFunction, entity: string): string {
  return isXeroEntity(entity) ? t(ENTITY_KEY[entity]) : entity;
}

/** Several entities' names, as one list a sentence interpolates. */
export function nameXeroEntities(t: TFunction, entities: readonly string[]): string {
  return entities.map((entity) => describeXeroEntity(t, entity)).join(", ");
}
