VENV := .venv-tests
PY   := $(VENV)/bin/python

.DEFAULT_GOAL := help
.PHONY: help venv verify test itest lint fmt doctor monitors up down seed slice clean

help:  ## Show available targets
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk -F':.*?## ' '{printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

venv: $(VENV)/.stamp  ## Build the test venv from pinned requirements

# Stamped so the gate does not pay for a pip resolve on every single run.
# Delete the stamp (or `make clean`) to force a rebuild.
$(VENV)/.stamp: requirements-dev.txt pyproject.toml
	@test -d $(VENV) || python3 -m venv $(VENV)
	@$(VENV)/bin/pip -q install -r requirements-dev.txt
	@$(VENV)/bin/pip -q install -e .
	@touch $@

verify: lint test  ## The gate: lint + tests. Run before claiming anything works.

lint: venv  ## ruff check + format check
	@$(VENV)/bin/ruff check .
	@$(VENV)/bin/ruff format --check .

fmt: venv  ## Apply formatting and safe fixes
	@$(VENV)/bin/ruff check --fix .
	@$(VENV)/bin/ruff format .

test: venv  ## Gate tests (excludes monitors by design)
	@$(PY) -m pytest -q

# Integration tests need credentials for the running stack, so they source
# .env. The plain `test` target deliberately does not: the gate must pass on a
# machine with no stack and no secrets, or CI cannot run it.
itest: venv  ## Integration tests against the running local stack
	@set -a; . deploy/compose/.env; set +a; $(PY) -m pytest tests/integration -q

doctor: venv  ## Check the stack is usable through the seams the pipeline uses
	@set -a; . deploy/compose/.env; set +a; $(PY) -m vcdo.cli.main doctor

monitors: venv  ## Data-drift monitors. Red here means drift, not a code defect.
	@$(PY) -m pytest tests/monitors/ -q

up:  ## Start the local stack (minio, postgres, kestra, metabase)
	@docker compose -f deploy/compose/docker-compose.yml up -d

down:  ## Stop the local stack, keeping volumes
	@docker compose -f deploy/compose/docker-compose.yml down

seed: venv  ## Load Airbyte-shaped fixture records into local MinIO
	@$(PY) -m vcdo.cli.main seed

slice: venv  ## Full fixture run: raw -> curated -> dashboard query
	@$(PY) -m vcdo.cli.main slice

clean:  ## Remove caches and the test venv
	@rm -rf $(VENV) .pytest_cache .ruff_cache
	@find . -name __pycache__ -type d -prune -exec rm -rf {} +
