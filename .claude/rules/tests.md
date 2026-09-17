---
paths:
  - "tests/**/*.py"
---

# Test discipline

`make verify` is the gate. It has to mean something, which constrains how tests
are written far more than coverage does.

## NEVER

- **NEVER write into the repo from a test.** Use `tmp_path`; anything under test
  takes an explicit output destination.
- **NEVER assert that a mock was called.** A suite that asserts a mock was
  called is green whether or not the code works.
- **NEVER import a module in a test without pinning it in
  `requirements-dev.txt`.** Installing by hand gives you green here and red on
  the next machine.
- **NEVER read coverage as correctness.**

## Follow

- **Prefer a real in-memory implementation over a mock.** `vcdo/lake/memory.py`
  exists for exactly this; extend it rather than reaching for a patch.
- **A guard needs two tests:** one proving it fires, one proving it stays quiet.
  A guard with only the first test is indistinguishable from a guard that always
  fires.
- **Pins are resolved as a set, in one `pip install`** — never package by
  package. Pinning independently once produced an unsatisfiable requirements
  file here, and the break only surfaced on a clean venv rebuild.
- **Report an interval, not a bare percentage.** Before trusting any extraction
  output, measure how much of it is *right*, and say how confident that estimate
  is.
- **Respect the gate/monitor split.** `tests/monitors/` binds to live data or
  deployed services; red there means data drift, not a code defect, so it is
  excluded from the gate via `norecursedirs` and run explicitly. Do not move a
  monitor into the gate to "get it running in CI" — you will be teaching people
  to ignore a red build. `tests/integration/` needs the docker stack and
  secrets, and is likewise outside the gate.

The plain `test` target deliberately does not source `.env`: the gate must pass
on a machine with no stack and no secrets, or CI cannot run it.
