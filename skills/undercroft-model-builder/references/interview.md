# The interview

The brief is what the model must be. Get it from the person, in their words, before any SQL.
Ask a few questions at a time and offer choices the data already shows. When they do not
know, say what you would choose and why, and let them decide.

## The questions

**1. What is it for?**

- What will this table answer, or which report or dashboard will read it?
- Who reads that report, and what do they decide with it?

The answer names the grain and the columns better than any question about tables can.

**2. What is one row?**

- One deal? One invoice line? One letter? One customer per month?
- Can the same thing appear twice, and if so, which copy wins -- the newest, the first?

Write the grain down as a sentence: "one row per HubSpot deal that has not been deleted".
The unique test on the key column is that sentence, checked.

**3. Where does it come from?**

- Which source and entity in the lake? Offer what `lake.summary` lists.
- Or which existing models? Offer what `models.list` lists.
- For a mailbox or Drive source with several accounts: all of them, or one? A further
  account lands as its own source, such as `gmail.3fa9c1d2e0ab`.

**4. Which columns?**

For each column, get four things:

- its name in the table (lowercase letters, digits and underscores);
- what it means, in one line;
- where it comes from: a payload key, a column of the lake, or another model's column;
- its type: text, a number, a date, a timestamp, a true/false.

Check each payload key against a sample before you accept it (`lake.records`). A key the
sample does not have is a question for the person, not a column.

**5. Which rows?**

- Only live records? The default is yes: a record deleted at its source has `deleted_at`
  set, and a model leaves it out.
- Any other filter: a pipeline, a status, a date range? A date range that should move with
  time is a question for the report, not for the model: a model has no parameters.

**6. Amounts and missing values**

- Which columns are amounts, and in which currency? An amount is read with the macro
  `models.reference` lists for it, never cast by hand, and never becomes a float.
- When a value is missing, it stays `NULL`. Ask only if the person wants something else,
  and write down what and why.

**7. The name**

Suggest one and let the person choose. A common convention, if they have none:

- `stg_<source>_<entity>` for one entity cleaned up: `stg_hubspot_deals`;
- `int_<what>` for a step others build on;
- `fct_<event>` for things that happened, `dim_<thing>` for things that are.

Check `models.list` first. A name that is taken is not a name to reuse without asking.

**8. Tests**

- The column that is one row: `unique` and `not_null`.
- Any column the report cannot do without: `not_null`.

Only these two tests exist per column. Say that a test failing does not stop the table from
being built; it tells the person which rows break the rule.

## The brief

Write it back and ask the person to agree:

```text
Model:    stg_hubspot_deals
For:      the pipeline dashboard's deal table
One row:  one HubSpot deal that has not been deleted
From:     source hubspot, entity deals
Columns:  deal_id    text       the deal's HubSpot id               source_record_id
          deal_name  text       the deal's name                    payload.properties.dealname
          stage      text       its pipeline stage                 payload.properties.dealstage
          amount     numeric    its amount, NULL when unreadable   payload.properties.amount
          closed_at  timestamp  when it closed, NULL if open       payload.properties.closedate
Rows:     live records only
Tests:    deal_id unique, not_null
```

Nothing is drafted until the person says the brief is right.
