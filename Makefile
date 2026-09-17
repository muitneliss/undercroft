VENV := .venv-tests
PY   := $(VENV)/bin/python
UI   := ui

.DEFAULT_GOAL := help
.PHONY: help venv verify test itest lint fmt doctor monitors up down seed slice provision-bi backup clean \
        ui-install ui-lint ui-test ui-build ui-dev api-dev

help:  ## Show available targets
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk -F':.*?## ' '{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

venv: $(VENV)/.stamp  ## Build the test venv from pinned requirements

# Stamped so the gate does not pay for a pip resolve on every single run.
# Delete the stamp (or `make clean`) to force a rebuild.
$(VENV)/.stamp: requirements-dev.txt pyproject.toml
	@test -d $(VENV) || python3 -m venv $(VENV)
	@$(VENV)/bin/pip -q install -r requirements-dev.txt
	@$(VENV)/bin/pip -q install -e .
	@touch $@

verify: lint test ui-lint ui-test  ## The gate. Run before claiming anything works.

# --- the UI half of the gate -------------------------------------------------
#
# `make verify` used to need nothing but Python. It now needs Bun as well, and
# that is a deliberate trade rather than an oversight: the control plane is the
# first non-Python code in the repo, and a second, separately-invoked gate is how
# two definitions of "green" start to drift.
#
# These targets FAIL LOUDLY when Bun is absent rather than skipping. A check that
# quietly passes because the toolchain is missing is exactly the failure
# .claude/rules/tests.md exists to prevent -- it trains people to trust a green
# run that verified nothing.

# Bun's own lockfile makes install a near no-op when nothing changed, so this is
# a dependency of the other three rather than something to remember.
BUN := $(shell command -v bun 2>/dev/null)

define REQUIRE_BUN
	@if [ -z "$(BUN)" ]; then \
	  echo "bun is required for the UI half of the gate."; \
	  echo "Install it with: curl -fsSL https://bun.sh/install | bash"; \
	  echo "(pinned version in $(UI)/.bun-version)"; \
	  exit 1; \
	fi
endef

ui-install:  ## Install UI dependencies (bun)
	$(REQUIRE_BUN)
	@cd $(UI) && bun install --frozen-lockfile

ui-lint: ui-install  ## ESLint, including the rule that keeps money out of a float
	$(REQUIRE_BUN)
	@cd $(UI) && bun run lint

ui-test: ui-install  ## Vitest. Offline: no stack, no credentials, no network.
	$(REQUIRE_BUN)
	@cd $(UI) && bun run test

ui-build: ui-install  ## Typecheck and build the SPA into ui/dist
	$(REQUIRE_BUN)
	@cd $(UI) && bun run build

ui-dev: ui-install  ## Vite dev server, proxying /api to the local control plane
	$(REQUIRE_BUN)
	@cd $(UI) && bun run dev

api-dev: venv  ## Run the control plane locally against the compose stack
	@set -a; . deploy/compose/.env; set +a; \
	 VCDO_UI_DIST=$(PWD)/$(UI)/dist \
	 $(VENV)/bin/uvicorn vcdo.api.app:app --reload --port 8000

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
# Backup/restore tests need pg_dump and pg_restore matching the server major
# version. Homebrew's libpq is not on PATH by default; without it those tests
# skip, and an untested restore is exactly what the backup module warns about.
	@set -a; . deploy/compose/.env; set +a; \
	 PATH="/opt/homebrew/opt/libpq/bin:/usr/lib/postgresql/17/bin:$$PATH" \
	 $(PY) -m pytest tests/integration -q

doctor: venv  ## Check the stack is usable through the seams the pipeline uses
	@set -a; . deploy/compose/.env; set +a; $(PY) -m vcdo.cli.main doctor

monitors: venv  ## Data-drift monitors. Red here means drift, not a code defect.
	@$(PY) -m pytest tests/monitors/ -q

up:  ## Start the local stack (minio, postgres, kestra, metabase)
	@docker compose -f deploy/compose/docker-compose.yml up -d

down:  ## Stop the local stack, keeping volumes
	@docker compose -f deploy/compose/docker-compose.yml down

seed: venv  ## Load fixture records into local MinIO
	@$(PY) -m vcdo.cli.main seed

backup: venv  ## Dump curated schemas (runs in the worker, which has pg_dump 17)
	@docker compose -f deploy/compose/docker-compose.yml exec -T worker \
	  python -m vcdo.cli.main backup

provision-bi: venv  ## Provision Metabase: admin + read-only curated connection
	@set -a; . deploy/compose/.env; set +a; $(PY) -m vcdo.cli.main provision-bi

slice: venv  ## Full fixture run: raw -> curated -> dashboard query
	@$(PY) -m vcdo.cli.main slice

clean:  ## Remove caches and the test venv
	@rm -rf $(VENV) .pytest_cache .ruff_cache
	@find . -name __pycache__ -type d -prune -exec rm -rf {} +
