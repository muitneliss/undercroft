/**
 * What a new model starts as: the one worked example the platform used to ship as a file.
 *
 * A HubSpot deals staging model, projected out of the generic raw table. It is the pattern
 * every model follows -- filter `raw.records` to one (source, entity), pull typed columns
 * out of the jsonb payload, and let the platform's rules hold in SQL: money through
 * `parse_amount` (never a float, NULL not 0), a tombstoned row excluded rather than
 * silently returned as live. Nothing about "deals" is baked into the platform; it is baked
 * into this text, which becomes the author's the moment they save it.
 */

/** The template, headed with the model's own name so the first line is already theirs. */
export function modelTemplate(name: string): string {
  return `-- ${name}: one worked staging model, HubSpot deals projected out of raw.records.
--
-- The pattern every model follows: filter raw.records to one (source, entity), pull typed
-- columns out of the jsonb payload, and let the platform's rules hold in SQL -- money
-- through parse_amount (never a float, NULL not 0), a tombstoned row excluded rather than
-- silently returned as live. Change the filter and the columns and it is your model.

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
`;
}
