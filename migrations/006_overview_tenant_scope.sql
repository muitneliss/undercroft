-- Scope the cross-source overview to a tenant.
--
-- WHY: the view aggregated across every tenant, so two tenants' deals and
-- invoices merged into one customer's figures. Caught by a regression test that
-- saw a single fixture deal reported as won twice.
--
-- This is the same defect as the one fixed in the raw lake key, recurring one
-- layer up: source record ids are only unique WITHIN a tenant, and so are the
-- entity keys derived from them. Any aggregate that crosses tenants is wrong,
-- and wrong in the direction that looks like more business than there is.

BEGIN;

DROP VIEW IF EXISTS curated.customer_commercial_overview;

CREATE VIEW curated.customer_commercial_overview AS
WITH deal_side AS (
    SELECT d.tenant_id,
           c.entity_id,
           min(c.display_name)                     AS customer,
           d.currency,
           date_trunc('month', d.closed_on)::date  AS period,
           count(*) FILTER (WHERE d.is_won)        AS deals_won,
           sum(d.amount) FILTER (WHERE d.is_won)   AS deal_value_won
    FROM curated.deals d
    JOIN curated.customers c
      ON c.tenant_id = d.tenant_id
     AND c.source = d.source
     AND c.source_record_id = d.customer_source_id
    WHERE c.entity_id IS NOT NULL AND d.closed_on IS NOT NULL
    GROUP BY d.tenant_id, c.entity_id, d.currency, date_trunc('month', d.closed_on)
),
invoice_side AS (
    SELECT i.tenant_id,
           c.entity_id,
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
    GROUP BY i.tenant_id, c.entity_id, i.currency, date_trunc('month', i.issued_on)
)
SELECT
    coalesce(d.tenant_id, v.tenant_id)   AS tenant_id,
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
  ON d.tenant_id = v.tenant_id
 AND d.entity_id = v.entity_id
 AND d.currency  = v.currency
 AND d.period    = v.period;

COMMIT;
