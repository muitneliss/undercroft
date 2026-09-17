-- One worked staging model: HubSpot deals, projected out of the generic raw table.
--
-- This is the pattern every user model follows -- filter raw.records to one (source,
-- entity), pull typed columns out of the jsonb payload, and let the platform's rules hold
-- in SQL: money through parse_amount (never a float, NULL not 0), a tombstoned row
-- excluded rather than silently returned as live.
--
-- Copy this, change the filter and the columns, and you have your own model. Nothing about
-- "deals" is baked into the platform; it is baked into this file, which is yours.

with deals as (
    select
        tenant_id,
        source_record_id                                as deal_id,
        payload -> 'properties' ->> 'dealname'          as deal_name,
        payload -> 'properties' ->> 'dealstage'         as stage,
        payload -> 'properties' ->> 'pipeline'          as pipeline,
        {{ parse_amount("payload -> 'properties'", 'amount') }} as amount,
        (payload -> 'properties' ->> 'closedate')::timestamptz as closed_at,
        source_updated_at,
        observed_at
    from {{ source('undercroft', 'records') }}
    where source = 'hubspot'
      and entity = 'deals'
      and deleted_at is null
)

select * from deals
