-- Cross-source linking support.
--
-- `uen` on customers is the company number, the only identifier strong enough to
-- merge two records on its own. It is nullable and usually null: most sources do
-- not carry one, and an absent identifier is an ordinary state rather than a
-- defect.

BEGIN;

ALTER TABLE curated.customers ADD COLUMN IF NOT EXISTS uen text;

CREATE INDEX IF NOT EXISTS customers_uen_idx ON curated.customers (uen) WHERE uen IS NOT NULL;

-- ---------------------------------------------------------------------------
-- The cross-source view the handoff asks for: deals alongside invoiced and paid,
-- per customer and period.
--
-- Deliberately a FULL OUTER JOIN on entity_id. An inner join would silently drop
-- a customer who exists in one system and not the other -- which is exactly the
-- population worth looking at, and exactly the one that disappears quietly.
--
-- Deal value and invoiced value are kept in SEPARATE columns and never added. A
-- deal is an expectation and an invoice is a claim on money; summing them
-- double-counts the same commercial event once it progresses from one to the
-- other.
--
-- Everything is grouped by currency. There is no total row across currencies,
-- because producing one would require an FX policy that has not been decided.
-- ---------------------------------------------------------------------------
-- DROP first: a later migration changes this view's column list, and
-- CREATE OR REPLACE cannot alter columns. Without the drop, replaying the
-- migration set on an existing database fails partway through.
DROP VIEW IF EXISTS curated.customer_commercial_overview;
CREATE VIEW curated.customer_commercial_overview AS
WITH deal_side AS (
    SELECT c.entity_id,
           min(c.display_name)                     AS customer,
           d.currency,
           date_trunc('month', d.closed_on)::date  AS period,
           count(*) FILTER (WHERE d.is_won)        AS deals_won,
           sum(d.amount) FILTER (WHERE d.is_won)   AS deal_value_won
    FROM curated.deals d
    JOIN curated.customers c
      ON c.tenant_id = d.tenant_id
     AND c.source = d.source
    WHERE c.entity_id IS NOT NULL AND d.closed_on IS NOT NULL
    GROUP BY c.entity_id, d.currency, date_trunc('month', d.closed_on)
),
invoice_side AS (
    SELECT c.entity_id,
           min(i.contact_name)                     AS customer,
           i.currency,
           date_trunc('month', i.issued_on)::date  AS period,
           count(*)                                AS invoices,
           sum(i.total)                            AS invoiced,
           sum(i.amount_paid)                      AS paid,
           sum(i.amount_credited)                  AS credited,
           sum(i.amount_due)                       AS outstanding
    FROM curated.invoices i
    JOIN curated.customers c
      ON c.tenant_id = i.tenant_id
     AND c.source = i.source
     AND c.source_record_id = i.contact_source_id
    WHERE c.entity_id IS NOT NULL AND i.counts_as_revenue AND i.issued_on IS NOT NULL
    GROUP BY c.entity_id, i.currency, date_trunc('month', i.issued_on)
)
SELECT
    coalesce(d.entity_id, v.entity_id)   AS entity_id,
    coalesce(d.customer,  v.customer)    AS customer,
    coalesce(d.currency,  v.currency)    AS currency,
    coalesce(d.period,    v.period)      AS period,
    d.deals_won,
    d.deal_value_won,
    v.invoices,
    v.invoiced,
    v.paid,
    v.credited,
    v.outstanding
FROM deal_side d
FULL OUTER JOIN invoice_side v
  ON d.entity_id = v.entity_id
 AND d.currency  = v.currency
 AND d.period    = v.period;

COMMIT;
