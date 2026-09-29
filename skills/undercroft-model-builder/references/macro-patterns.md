# Macro patterns

A macro is a named piece of dbt Jinja that a model calls, such as `{{ parse_amount(...) }}`.
The platform ships a few into every project. A customer can also have macros of its own,
saved by one of its admins, and every model of that customer can call them. This page says
how to find one to reuse, when to propose a new one, and what a definition must look like.

## Find one before you write one

- `macros.list` gives the customer's own macros, each with what it is for and its
  parameters. Read it at the start of the workflow, beside `models.list`.
- `macros.get` gives one macro's whole definition. Read it before you call a macro whose
  description leaves you unsure what it returns.
- `models.reference` gives the platform's macros and the customer's, with their text.

When a macro's description says it does what the brief needs, call it. Do not write the same
expression again beside it: two copies of one rule drift apart, and then two tables disagree
about the same thing.

## When to propose a macro

- The expression you are about to write is already in another model of this customer.
- The person asks for one.

Propose it; never save one unasked. Show the person the name, the description, the whole
definition and the models that will call it, and ask. Then:

1. Run `macros.check` on the definition. A finding with severity `error` is fixed before
   the person sees it as ready, as for a model.
2. On the person's yes, save it with `macros.save` and `create: true`. On `CONFLICT` the
   name is taken: read the existing one with `macros.get` and let the person choose.
3. Call it from the model, and run `models.check` on the model.

A macro changes what every model that calls it builds. Changing a saved one is a new
proposal, with the models that call it named.

## What a definition must be

The platform refuses a save, with `BAD_REQUEST`, unless all of these hold:

- The text is exactly one `{% macro name(...) %} ... {% endmacro %}` block. A comment may
  stand before it; nothing else may stand outside it.
- The macro's name in the text is the name it is saved under.
- The name is not reserved. Reserved: the platform's macros, dbt's own names (`ref`,
  `source`, `config`, `var` and the rest), any name containing `__`, and any name starting
  with `generate_`, `test_` or `materialization_`. A macro with one of those names would
  silently replace something the project relies on.
- The text holds no `materialization`, `test`, `snapshot` or `docs` block.

A description is required, up to 500 characters. Write what the macro returns and what it
takes, in a sentence another agent can choose it by.

A macro is a SQL fragment spliced into the model that calls it: no `;` and no write, as in
a model. Missing stays missing: a macro passes `NULL` through, never turns it into `0` or
`''`.

## Example: one form of a company's name

The same company is written many ways -- `Acme Trading Pte. Ltd.`, `ACME TRADING PRIVATE
LIMITED`, `Acme Trading Limited`. Matching on the name as written misses them. One macro
gives one comparable form: upper case, `&` as `AND`, punctuation as a space, the three
suffixes as one, spaces squeezed.

```jinja
{#
    One comparable form of a company's name: upper case, & as AND, punctuation as a space,
    PRIVATE LIMITED, PTE LTD and LIMITED as one suffix, runs of spaces as one.
    NULL stays NULL.
#}
{% macro normalise_company_name(value) %}
    btrim(
        regexp_replace(
            regexp_replace(
                regexp_replace(
                    replace(upper({{ value }}), '&', ' AND '),
                    '[[:punct:]]', ' ', 'g'
                ),
                '\s+', ' ', 'g'
            ),
            '\m(PRIVATE LIMITED|PTE LTD|LIMITED)$', 'PTE LTD'
        )
    )
{% endmacro %}
```

Saved as `normalise_company_name`, with a description such as "One comparable form of a
company's name: upper case, punctuation as spaces, the private-limited suffixes as one.
Takes a text expression; NULL stays NULL."

A model calls it with the expression to normalise, written as a string:

```sql
with companies as (
    select
        source_record_id                                                 as company_id,
        payload -> 'properties' ->> 'name'                               as company_name,
        {{ normalise_company_name("payload -> 'properties' ->> 'name'") }} as company_key
    from {{ source('undercroft', 'records') }}
    where source = 'hubspot'
      and entity = 'companies'
      and deleted_at is null
)

select * from companies
```

All three spellings above become `ACME TRADING PTE LTD`, and a second model that matches
companies by name calls the same macro rather than repeating it.

## Deleting a macro

`macros.delete` is its own act, with its own yes from the person, and this workflow does not
call it. The platform refuses it with `CONFLICT` while any model or other macro still calls
the macro, and names them: change those first.
