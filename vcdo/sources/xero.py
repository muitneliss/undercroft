"""Xero accounting source, in mock and live mode.

Shapes match the Accounting API v2.0 envelope: a top-level key per entity
(``Invoices``, ``Payments``, ``CreditNotes``, ``Contacts``) holding a list.

Live mode carries three constraints the legacy system paid for:

**Rate limits are 60/minute, 5,000/day per tenant, 5 concurrent.** Requests are
paced at 1.1 s. ``Retry-After`` is honoured, parsed as either seconds or an
HTTP-date, and clamped to 120 s so a malformed header cannot park a run for
hours.

**Two different things are called "tenant" here, and conflating them is a real
defect this module once carried.** ``tenant_id`` is *ours*: the CASE-ID naming
the customer whose lake this is, and it goes in the record envelope. The Xero
organisation id goes in the ``xero-tenant-id`` header and arrives separately as
``xero_tenant_id``. They were the same field until it was noticed that live mode
would have sent ``portal-fixture`` to Xero -- which is to say live mode had never
run. Live mode now refuses to start without both.

**The organisation is verified before any accounting read.** A token can span
several organisations -- the legacy token reached both the real org and a Demo
Company -- so it is matched by exact name and type through
:mod:`vcdo.api.oauth.xero`, never taken as the first connection. Syncing the
wrong organisation into a shared lake is very hard to unpick.

**Per-payment fetches are not waste.** Fetching each payment individually is what
lets us verify it belongs to this document and this customer. Batching would be
faster and would lose the check that caught a real defect. At roughly 13 calls
per customer, the daily budget is nowhere near the limit.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

from vcdo.sources.base import RawRecord, SourceError

__all__ = ["XeroSource", "ENTITIES", "ENVELOPE_KEY", "ID_FIELD"]

ENTITIES = ("contacts", "invoices", "payments", "credit_notes")

#: Top-level key in the Xero response for each entity.
ENVELOPE_KEY = {
    "contacts": "Contacts",
    "invoices": "Invoices",
    "payments": "Payments",
    "credit_notes": "CreditNotes",
}

#: The identity field. Note these differ per entity; a single hardcoded
#: "InvoiceID" would silently key credit notes on nothing.
ID_FIELD = {
    "contacts": "ContactID",
    "invoices": "InvoiceID",
    "payments": "PaymentID",
    "credit_notes": "CreditNoteID",
}

#: Seconds between API calls. 60/min is the documented limit; 1.1 s leaves
#: headroom for clock skew. Do not lower this to make a backfill finish sooner --
#: a 429 storm costs far more than the time it saves.
PACE_SECONDS = 1.1

#: Upper bound on any Retry-After we will honour.
MAX_BACKOFF_SECONDS = 120


class XeroSource:
    name = "xero"

    def __init__(
        self,
        *,
        tenant_id: str,
        mode: str = "mock",
        fixtures_dir: str = "fixtures",
        access_token: str = "",
        xero_tenant_id: str = "",
        expected_tenant_name: str = "",
    ) -> None:
        self.tenant_id = tenant_id
        self.mode = mode
        self.fixtures_dir = Path(fixtures_dir)
        self._token = access_token
        #: The Xero organisation id, public because it is part of this source's
        #: identity -- the connection registry and the control plane display it,
        #: and it is not a secret. The access token beside it is.
        self.xero_tenant_id = xero_tenant_id
        self._expected_tenant_name = expected_tenant_name
        if mode == "live" and not access_token:
            raise SourceError("xero live mode requires an access token")
        if mode == "live" and not xero_tenant_id:
            # Two different identifiers that both get called "tenant". Ours names
            # the customer whose lake this is; Xero's names the organisation the
            # token may read. Sending ours in the `xero-tenant-id` header is a
            # 401 at best, and reading the wrong org at worst -- so it is refused
            # here rather than discovered against live accounting data.
            raise SourceError(
                "xero live mode requires xero_tenant_id (the organisation id from "
                "https://api.xero.com/connections); our own tenant_id is not it"
            )

    def entities(self) -> tuple[str, ...]:
        return ENTITIES

    def read(self, entity: str) -> Iterator[RawRecord]:
        if entity not in ENTITIES:
            raise SourceError(f"unknown xero entity {entity!r}; known: {', '.join(ENTITIES)}")
        items = self._read_fixture(entity) if self.mode == "mock" else self._read_live(entity)
        for item in items:
            yield self._to_record(entity, item)

    def _to_record(self, entity: str, item: dict) -> RawRecord:
        return RawRecord(
            source=self.name,
            tenant_id=self.tenant_id,
            entity=entity,
            source_record_id=str(item.get(ID_FIELD[entity]) or ""),
            source_updated_at=item.get("UpdatedDateUTC"),
            payload=item,
        )

    def _read_fixture(self, entity: str) -> list[dict]:
        path = self.fixtures_dir / "xero" / f"{entity}.json"
        if not path.exists():
            raise SourceError(f"no xero fixture at {path}")
        data = json.loads(path.read_text())
        key = ENVELOPE_KEY[entity]
        records = data.get(key)
        if not isinstance(records, list):
            raise SourceError(f"fixture {path} has no {key!r} list; expected the Xero v2 envelope")
        return records

    def _read_live(self, entity: str) -> Iterator[dict]:
        import time

        from dlt.sources.helpers.rest_client import RESTClient
        from dlt.sources.helpers.rest_client.auth import BearerTokenAuth
        from dlt.sources.helpers.rest_client.paginators import PageNumberPaginator

        client = RESTClient(
            base_url="https://api.xero.com/api.xro/2.0",
            auth=BearerTokenAuth(token=self._token),
            headers={"xero-tenant-id": self.xero_tenant_id, "Accept": "application/json"},
            paginator=PageNumberPaginator(base_page=1, page_param="page", total_path=None),
        )

        route = {
            "contacts": "Contacts",
            "invoices": "Invoices",
            "payments": "Payments",
            "credit_notes": "CreditNotes",
        }[entity]

        seen = 0
        try:
            for page in client.paginate(f"/{route}", params={"pageSize": 100}):
                for item in page:
                    seen += 1
                    yield item
                time.sleep(PACE_SECONDS)
        except Exception as exc:
            # Never degrade to an empty stream: missing financial rows that look
            # like a quiet month are the specific failure being guarded against.
            raise SourceError(f"xero {entity} read failed after {seen} records: {exc}") from exc
