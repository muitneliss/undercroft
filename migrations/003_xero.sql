-- Xero curated tables: invoices and payments.
--
-- Money is NUMERIC(18,4) and currency is mandatory alongside it, same as deals.
-- Amounts are stored in their ORIGINAL currency with the invoice's own rate
-- recorded beside them. No converted column: conversion belongs to a dated FX
-- table and a stated policy, and a pre-converted figure with no visible rate is
-- impossible to audit later.

BEGIN;

-- ---------------------------------------------------------------------------
-- curated.invoices
--
-- GRAIN:        one row per (source, tenant_id, source_record_id)
-- NATURAL KEY:  (source, tenant_id, source_record_id)
--
-- ACCREC is a customer invoice (revenue); ACCPAY is a supplier bill. Both are
-- stored -- the legacy system uses the distinction as identity evidence, since a
-- contact with ACCPAY documents is a vendor, not a client -- but only ACCREC is
-- ever revenue.
--
-- VOIDED and DELETED invoices are RETAINED, never deleted. They are evidence
-- that something was cancelled, and a row that vanishes cannot be reconciled
-- against. `counts_as_revenue` is the single place that decision is expressed,
-- so no dashboard has to remember the rule.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS curated.invoices (
    source             text        NOT NULL,
    tenant_id          text        NOT NULL,
    source_record_id   text        NOT NULL,

    entity_id          text,
    contact_source_id  text,
    contact_name       text,
    invoice_number     text,
    invoice_type       text        NOT NULL,   -- ACCREC | ACCPAY
    status             text        NOT NULL,

    currency           char(3)     NOT NULL,
    currency_rate      numeric(18, 8),
    total              numeric(18, 4),
    amount_paid        numeric(18, 4),
    amount_credited    numeric(18, 4),
    amount_due         numeric(18, 4),

    -- Derived once, here, rather than in every query that wants revenue.
    counts_as_revenue  boolean     NOT NULL,

    issued_on          date,
    due_on             date,
    source_updated_at  timestamptz,

    run_id             text        NOT NULL,
    lake_key           text        NOT NULL,
    built_at           timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (source, tenant_id, source_record_id),

    CONSTRAINT invoices_currency_is_iso CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT invoices_type_known      CHECK (invoice_type IN ('ACCREC', 'ACCPAY'))
);

CREATE INDEX IF NOT EXISTS invoices_contact_idx ON curated.invoices (contact_source_id);
CREATE INDEX IF NOT EXISTS invoices_entity_idx  ON curated.invoices (entity_id);
CREATE INDEX IF NOT EXISTS invoices_issued_idx  ON curated.invoices (issued_on);

-- ---------------------------------------------------------------------------
-- curated.payments
--
-- GRAIN:        one row per (source, tenant_id, source_record_id)
-- NATURAL KEY:  (source, tenant_id, source_record_id)
--
-- `target_type` is the important column. In Xero a payment's parent arrives
-- under an 'Invoice' key even when it belongs to a CREDIT NOTE, with the
-- InvoiceID field carrying the CreditNoteID. The legacy schema stored a single
-- polymorphic invoice_id with a comment warning that it might be an invoice, an
-- overpayment or a credit note -- which means every consumer has to remember.
-- Here the type is explicit and resolved by id at load time.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS curated.payments (
    source             text        NOT NULL,
    tenant_id          text        NOT NULL,
    source_record_id   text        NOT NULL,

    payment_type       text,
    status             text,

    target_type        text        NOT NULL,   -- invoice | credit_note | prepayment | overpayment | unresolved
    target_source_id   text,
    contact_source_id  text,

    currency_rate      numeric(18, 8),
    amount             numeric(18, 4),
    currency           char(3),

    paid_on            date,
    source_updated_at  timestamptz,

    run_id             text        NOT NULL,
    lake_key           text        NOT NULL,
    built_at           timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (source, tenant_id, source_record_id),

    CONSTRAINT payments_amount_needs_currency
        CHECK (amount IS NULL OR currency IS NOT NULL),
    CONSTRAINT payments_target_known CHECK (
        target_type IN ('invoice', 'credit_note', 'prepayment', 'overpayment', 'unresolved')
    )
);

CREATE INDEX IF NOT EXISTS payments_target_idx  ON curated.payments (target_type, target_source_id);
CREATE INDEX IF NOT EXISTS payments_contact_idx ON curated.payments (contact_source_id);

-- ---------------------------------------------------------------------------
-- ops.gate_finding -- what the reconciliation gate decided, and why.
--
-- Kept as data rather than a log line. "The gate blocked" is not actionable;
-- "invoice X is off by 12.30" is. It is also the record that shows a blocked
-- publish was a correct refusal rather than an outage.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ops.gate_finding (
    id           bigserial   PRIMARY KEY,
    run_id       text        NOT NULL,
    source       text        NOT NULL,
    severity     text        NOT NULL CHECK (severity IN ('block', 'review')),
    code         text        NOT NULL,
    document_id  text,
    detail       text,
    recorded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gate_finding_run_idx ON ops.gate_finding (run_id);

-- ---------------------------------------------------------------------------
-- Revenue by customer, currency and period.
--
-- Grouped by currency, never summed across it. Credit notes are netted off via
-- amount_credited rather than added as a separate positive line, and paid is
-- reported beside invoiced rather than added to it -- adding invoiced and paid
-- would double-count the same money.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW curated.revenue_by_customer_period AS
SELECT
    i.tenant_id,
    i.contact_source_id,
    i.contact_name,
    i.currency,
    date_trunc('month', i.issued_on)::date        AS period,
    count(*)                                      AS invoices,
    sum(i.total)                                  AS invoiced,
    sum(i.amount_paid)                            AS paid,
    sum(i.amount_credited)                        AS credited,
    sum(i.amount_due)                             AS outstanding,
    sum(i.total - i.amount_credited)              AS net_invoiced
FROM curated.invoices i
WHERE i.counts_as_revenue
GROUP BY i.tenant_id, i.contact_source_id, i.contact_name, i.currency, date_trunc('month', i.issued_on);

COMMIT;
