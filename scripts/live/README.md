# Real-data checks

This folder holds the checks that read real data. Each maps a source to the lake one record at a
time: if the source has record A, the lake must have record A, at the same version, with the same
values. Nothing here runs in `bun run test` or in CI.

```sh
UNDERCROFT_LIVE=1 bun test ./scripts/live/hubspot.live.ts
```

## What `hubspot.live.ts` checks

| Tests                                 | One per                           | Passes when                                                                      |
| ------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------- |
| `HubSpot <object> → lake`             | live company, contact and deal    | the lake holds it at the same `updatedAt`, every property equal, `null` included |
| `lake <object> → HubSpot`             | lake record HubSpot no longer has | the lake marks it deleted at source                                              |
| `HubSpot deal → company links → lake` | live deal                         | the lake links it to exactly the companies HubSpot does                          |

A record that changed in HubSpot after the last run began is reported **skipped**: the next run
reads it, this one could not have. A failure names the properties that differ, never their values.

If a HubSpot run begins while the check is reading, it stops instead of reporting: the two sides
would disagree for reasons that are not the lake's.

## Read-only, on both sides

- **HubSpot** is read with GET, search and batch read, the way the connector reads it, asking for
  exactly the properties the lake holds. Any other request is refused before it is sent.
- **The lake** is read through the Undercroft CLI's read commands (`lake records`, `runs list`)
  with your own signed-in profile. Never the database.

## Configuration stays local

`fixtures/live/` is gitignored. Put the configuration there, or point `UNDERCROFT_LIVE_CONFIG` at
it:

```json
{
  "tenant": "CASE-0042",
  "cli": ["undercroft"],
  "tokenFile": "fixtures/live/hubspot.token",
  "requestsPerMinute": 80
}
```

- `tokenFile` holds a HubSpot private-app token with read scopes only:
  `crm.objects.companies.read`, `crm.objects.contacts.read`, `crm.objects.deals.read`.
- `cli` is the command that runs the Undercroft CLI, signed in to the tenant.
- The time taken grows with the portal: every record is read from both sides.

The offline tests for the readers and the comparison are in `hubspotLake.test.ts` and run in the
gate like any other suite.
