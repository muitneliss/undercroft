-- Give a deal its owner.
--
-- WHY: the first version of curated.customer_commercial_overview had no
-- deal->customer edge to join on, so it joined on `source` alone -- a cartesian
-- product that credited every contact with every company's deals. Each row
-- looked entirely plausible; the totals were fabricated. That is the exact
-- failure mode the "never guess" rule exists for, and it was invisible until
-- someone read the rows.
--
-- NULL is a real and acceptable state: a deal with no company association in
-- HubSpot genuinely has no owner here, and it must be VISIBLY unattributed
-- rather than attributed to everyone.

BEGIN;

ALTER TABLE curated.deals ADD COLUMN IF NOT EXISTS customer_source_id text;

CREATE INDEX IF NOT EXISTS deals_customer_idx
    ON curated.deals (source, customer_source_id)
    WHERE customer_source_id IS NOT NULL;

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
    -- Joined on the ASSOCIATION, not on source. A deal with no association
    -- contributes to nobody rather than to everybody.
    JOIN curated.customers c
      ON c.tenant_id = d.tenant_id
     AND c.source = d.source
     AND c.source_record_id = d.customer_source_id
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

-- Deals we could not attribute. Surfaced as a first-class view rather than left
-- for someone to notice: an unattributed deal is missing from every
-- customer-level figure, and that absence is silent.
DROP VIEW IF EXISTS curated.unattributed_deals;
CREATE VIEW curated.unattributed_deals AS
SELECT source, tenant_id, source_record_id, deal_name, stage, amount, currency, closed_on
FROM curated.deals
WHERE customer_source_id IS NULL;

COMMIT;
