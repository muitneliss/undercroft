{#
    Read a money amount out of a jsonb payload as a fixed-precision numeric, or NULL.

    The same rule as the rest of the platform, in SQL: never a float, never a guess. A
    value that is not a clean number becomes NULL -- a visibly missing cell -- rather than
    0, which would be a fabricated fact indistinguishable from a real zero. The cast goes
    jsonb -> text -> numeric, never through `double precision`.
#}
{% macro parse_amount(payload, key) %}
    CASE
        WHEN ({{ payload }} ->> '{{ key }}') ~ '^-?[0-9]+(\.[0-9]+)?$'
        THEN ({{ payload }} ->> '{{ key }}')::numeric(18, 4)
        ELSE NULL
    END
{% endmacro %}
