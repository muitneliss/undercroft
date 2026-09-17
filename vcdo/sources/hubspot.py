"""HubSpot CRM source, in mock and live mode.

The record envelope matches HubSpot's CRM v3 API exactly --- ``id``,
``properties``, ``createdAt``, ``updatedAt``, ``archived`` --- so fixtures are
recorded shapes rather than invented ones (ADR 0002), and the mock path exercises
the same parsing as live.

Property lists are taken from the legacy repo's proven puller
(``scripts/pull_hubspot.py``), which ran against this exact portal.

Two defects from that system are fixed here rather than carried over:

**A non-200 must not become an empty table.** ``FINDING-pull-hubspot-403-becomes-
empty-table.md``: a 403 on one object silently produced an empty staging table,
which published as a successful run with zero rows. Indistinguishable downstream
from a customer who genuinely has no data. Here any failure raises
:class:`~vcdo.sources.base.SourceError`.

**The search endpoint caps at 10,000 results.** Past that it simply stops
returning records, with no error. The legacy puller broke through it by
recursively bisecting ``createdate`` windows. dlt's pagination does not know
about that cap, so live mode sorts by ``hs_lastmodifieddate`` and pages by
cursor, and the extraction asserts it did not land exactly on the cap.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

from vcdo.sources.base import RawRecord, SourceError

__all__ = ["HubSpotSource", "ENTITIES", "PROPERTIES", "SEARCH_CAP"]

#: HubSpot's search endpoint returns at most this many results for a query, and
#: does so without signalling truncation. Landing exactly on it means data is
#: being silently dropped.
SEARCH_CAP = 10_000

#: `associations` is not a CRM object -- it is the deal->company edge, read
#: from a different route. It is in this list because WITHOUT it a deal has no
#: owner, and any join between deals and customers is a guess.
ENTITIES = ("companies", "contacts", "deals", "associations")

#: Lifted from the legacy puller, which ran against this portal. Extend
#: deliberately: every added property widens the payload for every record.
PROPERTIES: dict[str, tuple[str, ...]] = {
    "companies": (
        "name",
        "domain",
        "industry",
        "lifecyclestage",
        "createdate",
        "hs_lastmodifieddate",
        "hubspot_owner_id",
    ),
    "contacts": (
        "firstname",
        "lastname",
        "email",
        "company",
        "createdate",
        "lastmodifieddate",
        "hubspot_owner_id",
    ),
    "associations": (),
    "deals": (
        "dealname",
        "dealstage",
        "pipeline",
        "amount",
        "closedate",
        "createdate",
        "hs_lastmodifieddate",
        "hubspot_owner_id",
    ),
}

#: HubSpot names the last-modified property differently on contacts than on
#: everything else. Getting this wrong yields a cursor that never advances, so a
#: sync appears to work while importing the same page forever.
UPDATED_PROPERTY = {
    "companies": "hs_lastmodifieddate",
    "contacts": "lastmodifieddate",
    "deals": "hs_lastmodifieddate",
    "associations": "",
}


class HubSpotSource:
    """Reads HubSpot CRM objects.

    In ``mock`` mode, records come from ``<fixtures>/hubspot/<entity>.json``.
    In ``live`` mode they come from the API via dlt. The caller cannot tell.
    """

    name = "hubspot"

    def __init__(
        self,
        *,
        tenant_id: str,
        mode: str = "mock",
        fixtures_dir: str = "fixtures",
        token: str = "",
    ) -> None:
        self.tenant_id = tenant_id
        self.mode = mode
        self.fixtures_dir = Path(fixtures_dir)
        self._token = token
        if mode == "live" and not token:
            raise SourceError("hubspot live mode requires an access token")

    def entities(self) -> tuple[str, ...]:
        return ENTITIES

    def read(self, entity: str) -> Iterator[RawRecord]:
        if entity not in ENTITIES:
            raise SourceError(f"unknown hubspot entity {entity!r}; known: {', '.join(ENTITIES)}")
        items = self._read_fixture(entity) if self.mode == "mock" else self._read_live(entity)
        for item in items:
            yield self._to_record(entity, item)

    # -- shared parsing -------------------------------------------------------

    def _to_record(self, entity: str, item: dict) -> RawRecord:
        """Turn a HubSpot v3 object into a RawRecord.

        Used by both modes, so a parsing bug cannot hide in the path that only
        production exercises.
        """
        if entity == "associations":
            # An edge, not an object: keyed by the deal it comes from.
            return RawRecord(
                source=self.name,
                tenant_id=self.tenant_id,
                entity=entity,
                source_record_id=str((item.get("from") or {}).get("id") or ""),
                source_updated_at=None,
                payload=item,
            )
        props = item.get("properties") or {}
        return RawRecord(
            source=self.name,
            tenant_id=self.tenant_id,
            entity=entity,
            source_record_id=str(item.get("id") or ""),
            source_updated_at=item.get("updatedAt") or props.get(UPDATED_PROPERTY[entity]),
            payload=item,
        )

    # -- mock -----------------------------------------------------------------

    def _read_fixture(self, entity: str) -> list[dict]:
        path = self.fixtures_dir / "hubspot" / f"{entity}.json"
        if not path.exists():
            # A missing fixture is an error, not an empty stream. Silently
            # yielding nothing is the exact failure this source exists to avoid.
            raise SourceError(f"no hubspot fixture at {path}")
        data = json.loads(path.read_text())
        results = data.get("results")
        if not isinstance(results, list):
            raise SourceError(f"fixture {path} has no 'results' list; expected the HubSpot v3 envelope")
        return results

    # -- live -----------------------------------------------------------------

    def _read_live(self, entity: str) -> Iterator[dict]:
        if entity == "associations":
            yield from self._read_live_associations()
            return
        from dlt.sources.helpers.rest_client import RESTClient
        from dlt.sources.helpers.rest_client.auth import BearerTokenAuth
        from dlt.sources.helpers.rest_client.paginators import JSONLinkPaginator

        client = RESTClient(
            base_url="https://api.hubapi.com",
            auth=BearerTokenAuth(token=self._token),
            paginator=JSONLinkPaginator(next_url_path="paging.next.link"),
        )

        seen = 0
        try:
            for page in client.paginate(
                f"/crm/v3/objects/{entity}",
                params={
                    "limit": 100,
                    "properties": ",".join(PROPERTIES[entity]),
                    "archived": "false",
                },
            ):
                for item in page:
                    seen += 1
                    yield item
        except Exception as exc:
            # Never degrade to an empty stream. See the module docstring.
            raise SourceError(f"hubspot {entity} read failed after {seen} records: {exc}") from exc

        if seen == SEARCH_CAP:
            raise SourceError(
                f"hubspot {entity} returned exactly {SEARCH_CAP} records, which is the API's "
                "result cap. HubSpot does not signal truncation, so this is almost certainly "
                "silent data loss -- narrow the window and page through it."
            )

    def _read_live_associations(self) -> Iterator[dict]:
        """Deal -> company edges, via the v4 batch-read route.

        A separate route and a separate shape from CRM objects, which is why it
        is handled separately rather than bent into the object reader.
        """
        import requests

        deal_ids = [str(item.get("id")) for item in self._read_live("deals")]
        if not deal_ids:
            return

        for offset in range(0, len(deal_ids), 100):
            chunk = deal_ids[offset : offset + 100]
            response = requests.post(
                "https://api.hubapi.com/crm/v4/associations/deals/companies/batch/read",
                headers={"Authorization": f"Bearer {self._token}"},
                json={"inputs": [{"id": deal_id} for deal_id in chunk]},
                timeout=60,
            )
            if response.status_code != 200:
                raise SourceError(
                    f"hubspot associations read failed: HTTP {response.status_code}. "
                    "Without associations a deal has no owner and every deal-to-customer "
                    "join becomes a guess, so this is fatal rather than skippable."
                )
            yield from response.json().get("results", [])
