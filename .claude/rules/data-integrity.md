---
paths:
  - "vcdo/**/*.py"
  - "migrations/**/*.sql"
---

# Data integrity: money, and never guessing

Both rules below were learned expensively in the legacy system, and both fail
*silently* — which is why they are enforced here rather than trusted to care.
A wrong number and a guessed identity do not raise; they arrive in a dashboard
looking exactly like facts.

## NEVER

- **NEVER use `float` for a monetary amount.** Not to parse it, not to
  accumulate it, not "just for the intermediate step".
- **NEVER default an unreadable amount to `0`.** A zero is indistinguishable
  from a real zero downstream, so a parse failure that returns zero is data loss
  that looks like a fact.
- **NEVER emit a best-guess identity code.** An unresolved identity is `""`.
- **NEVER convert between currencies implicitly.** No ambient default, no
  "they're all SGD anyway".
- **NEVER treat "no evidence" as "pass".** The absence of a mismatch is not a
  match.

## Follow

- **`Decimal` end to end.** `NUMERIC(18,4)` in Postgres. Quantize with an
  explicit rounding mode; `ROUND_HALF_UP` unless there is a recorded reason.
- **Amounts carry their currency.** Two amounts in different currencies are not
  comparable. Conversion is an explicit step through a *dated* rate.
- **Comparison is three-valued:** `ok` / `mismatch` / `unverified`. Refusing to
  compare is a correct answer. `unverified` is a real outcome — do not collapse
  it into either of the other two to make a caller's branching simpler.
- **Return `None` and record why.** When a value cannot be read, the caller
  records the reason. An empty cell is visibly missing; a wrong value is
  invisibly false, and only one of those gets caught.
- **A normalised name is a matching key, never a display value and never
  identity.** It is lossy on purpose. It is weak evidence — enough to propose a
  link for review, never enough to merge two records on its own.

See `vcdo/core/money.py` and `vcdo/core/names.py`; both docstrings record the
specific legacy failures these rules exist to prevent.
