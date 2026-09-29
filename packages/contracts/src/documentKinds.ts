/**
 * The kinds of document a business keeps, as one generic catalogue a tenant's own is drawn from.
 *
 * NOT A BUSINESS SCHEMA. `CLAUDE.md` forbids the platform shipping one, and this is not: it names
 * what a document IS -- an invoice, a passport, a board resolution -- not what a customer's
 * business does with it, and every business keeps some of these and none keeps all. A tenant's
 * catalogue is a subset of it, chosen by classifying a sample of the tenant's own text into the
 * whole list and keeping what occurs, then edited by the tenant's admin. Nothing classifies a
 * document into this list directly in production.
 *
 * WHY A LIST AT ALL. The classifier (Jev) answers a question it is given; it does not invent the
 * answers. A choice question needs its labels, and the platform has no generative model to propose
 * them (no Anthropic key is required to run it). A list this broad is how a tenant gets a first
 * catalogue with no one writing one: its gaps show up as `other`, which is measured.
 *
 * THE DESCRIPTION IS WHAT THE CLASSIFIER READS, so it says what distinguishes a kind from its
 * neighbours -- a receipt from a payment confirmation, a resolution from minutes. The `kind` is
 * the value that is stored; it never changes meaning once a result carries it.
 */

export interface DocumentKind {
  /** The stored value: lowercase, underscores. */
  readonly kind: string;
  /** What the classifier is told the kind means. English, because the classifier reads it. */
  readonly description: string;
}

/** The question every document-kind choice asks. */
export const DOCUMENT_KIND_INSTRUCTION = "Classify the primary type of this document.";

export const DOCUMENT_KINDS: readonly DocumentKind[] = [
  {
    kind: "invoice",
    description: "A bill requesting payment for goods or services, including a tax invoice.",
  },
  {
    kind: "credit_note",
    description: "A document reducing or cancelling an amount previously invoiced.",
  },
  { kind: "receipt", description: "A record issued by a seller that a payment was received." },
  {
    kind: "payment_confirmation",
    description:
      "A bank or payment-app notice that a transfer or payment was made: transaction details, remittance advice.",
  },
  {
    kind: "quotation",
    description: "A price offer or quote for goods or services, before any order.",
  },
  { kind: "purchase_order", description: "An order placed with a supplier for goods or services." },
  {
    kind: "delivery_note",
    description: "A delivery order, goods received note or proof of delivery.",
  },
  { kind: "packing_list", description: "A list of the goods and packages in one shipment." },
  {
    kind: "customs_declaration",
    description: "An import or export declaration lodged with customs.",
  },
  {
    kind: "shipping_document",
    description: "A bill of lading, airway bill, certificate of origin or other freight document.",
  },
  {
    kind: "bank_statement",
    description: "A statement of the transactions on a bank or card account.",
  },
  {
    kind: "financial_statement",
    description:
      "A balance sheet, profit and loss, cash flow statement or set of audited accounts.",
  },
  {
    kind: "tax_document",
    description: "A tax return, assessment, registration or other filing with a tax authority.",
  },
  {
    kind: "payroll_document",
    description: "A payslip, salary schedule or social-contribution statement.",
  },
  {
    kind: "contract",
    description: "An agreement setting out obligations between parties, or an amendment to one.",
  },
  {
    kind: "corporate_resolution",
    description:
      "A resolution of a company's directors or members, including a written resolution.",
  },
  {
    kind: "company_register",
    description:
      "A register of directors, members, nominees or controllers, or a company profile from a registry.",
  },
  {
    kind: "incorporation_document",
    description: "A constitution, certificate of incorporation or business registration.",
  },
  {
    kind: "kyc_form",
    description:
      "A customer due diligence, know-your-customer, onboarding or account-opening form.",
  },
  {
    kind: "application_form",
    description:
      "A completed application, registration or request form that no more specific kind covers.",
  },
  {
    kind: "identity_document",
    description:
      "A passport, national identity card, visa, work pass or other personal identification.",
  },
  { kind: "resume", description: "A CV, resume, portfolio or job application of one person." },
  {
    kind: "employment_document",
    description: "An offer letter, HR letter or leave record about one person's employment.",
  },
  {
    kind: "certificate",
    description: "A certificate, licence, accreditation or award issued to a person or a company.",
  },
  {
    kind: "insurance_document",
    description: "An insurance policy, schedule, certificate or claim.",
  },
  {
    kind: "legal_document",
    description:
      "A power of attorney, court document, legal notice, affidavit or statutory declaration.",
  },
  {
    kind: "report",
    description:
      "An account of findings, figures or activity, such as an audit, assessment or project report.",
  },
  {
    kind: "meeting_minutes",
    description: "The minutes, agenda or notes of a meeting, other than a resolution.",
  },
  { kind: "presentation", description: "Slides or a pitch deck." },
  {
    kind: "marketing_material",
    description: "A brochure, flyer, catalogue, menu, advertisement, logo or press release.",
  },
  {
    kind: "newsletter",
    description: "A newsletter, bulletin or mass mailing sent to subscribers.",
  },
  {
    kind: "event_invitation",
    description: "An invitation to, registration for or programme of an event.",
  },
  {
    kind: "travel_document",
    description: "A ticket, itinerary, boarding pass or booking confirmation.",
  },
  { kind: "correspondence", description: "A letter, memo or personal message written to someone." },
  {
    kind: "notification",
    description: "An automated notification, alert, reminder or account message sent by a system.",
  },
  {
    kind: "policy_or_procedure",
    description: "A policy, procedure, handbook, manual or guideline.",
  },
  {
    kind: "data_listing",
    description:
      "A table, list or export of records with no narrative, such as a contact list or price list.",
  },
  { kind: "other", description: "None of the above." },
];
