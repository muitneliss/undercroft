# 158. A spec names the arrays that are sets, and the runtime lands them in one order

- Status: Accepted
- Date: 2026-11-25

## Context

The raw lake keeps a new version of a record whenever the digest of its canonical payload changes
(`.claude/rules/raw-lake.md`). `canonicalJson` (`packages/core/src/canonicalJson.ts`) sorts object
keys, so a source that reorders fields is not a change, and leaves arrays as they are, because an
array's order is usually something the source said.

HubSpot's v4 association batch read (`/crm/v4/associations/<from>/<to>/batch/read`, seventeen
entities in `specs/connectors/hubspot.yaml`) answers each record as
`{"from":{"id":…},"to":[{"toObjectId":…,"associationTypes":[…]}]}`, and returns
`to[].associationTypes` -- and possibly `to` -- in an order that changes from one call to the next.
A link that is both primary (`typeId` 1) and unlabelled (`typeId` 279) arrives as `[1, 279]` on one
sync and `[279, 1]` on the next.

Measured in production on one tenant: `contact_companies` held about 6,100 records and about
190,600 versions in the lake -- roughly thirty-one per record, alternating between the same two
payloads, A, B, A, B. `associations` (deals to companies) and `quote_companies` showed the same
pattern at about 15,000 and 9,000 versions. None of those versions recorded a change at HubSpot;
each was the same set in the other order. Besides the storage, every such version re-projects the
record into `raw.records` and makes a link that never changed look as if it changed every sync.

## Decision

1. **An entity declares its unordered arrays: `unorderedArrays`**, a list of paths into the
   record. A path is dotted names where `name[]` steps into each element of an array, and it ends
   at the array itself: `to`, `to[].associationTypes`. No `[n]` index: picking one element out of
   an order the declaration says is not there would mean nothing. Validated in
   `packages/contracts/src/connectorSpec.ts`.
2. **The runtime sorts each declared array by its elements' canonical JSON** before the payload is
   canonicalised, deepest path first so a set of sets is sorted by elements already in their one
   order. Canonical JSON is ASCII, so the comparison is the same on every machine. A path that
   does not reach an array on a given record -- absent, `null`, an object -- leaves that record as
   the source sent it.
3. **The sorted form is what is stored**, not only what is hashed. The bytes in the lake are the
   bytes the digest is of, so content addressing stays one fact rather than two, and `LakeStore`
   stays ignorant of specs.
4. **One function does it, and it is public**: `canonicalPayload(payload, unorderedArrays)` in
   `@undercroft/connector-runtime` (`packages/connector-runtime/src/unordered.ts`). The runtime's
   `outOf` calls it for every record, after the declared documents are taken out (ADR 0101).
   Anything that re-canonicalises a payload already in the lake calls the same function, so the
   two cannot disagree about what "the same record" is.
5. **Every HubSpot v4 association entity declares `[to, "to[].associationTypes"]`.** A link's
   kind is its `typeId` and `category`, never its position, and the links of a record are the set
   of objects it is linked to.

Arrays not declared keep their order. Rule 2 of `CLAUDE.md` -- never guess -- applies to the
declaration: order is dropped only where a spec says it carries nothing.

## Consequences

- A record whose stored payload is not already in the sorted order lands one more version the
  first time it is read after this ships, and then stays `unchanged` until HubSpot changes the
  set. The versions already in the lake are untouched: raw is create-only, and removing the
  flip-flop history is a separate, explicit compaction step that must use `canonicalPayload`.
- The archive no longer holds the order HubSpot happened to send a set in. That is the same
  trade `canonicalJson` already makes for key order, and only where the spec says so.
- A source whose array order does mean something keeps it unless an author declares otherwise;
  a wrong declaration is visible in the spec, beside the entity it governs.

## Options rejected

- **Sort every array in `canonicalJson`.** Fixes this source by breaking every other: a list of
  line items, a history, a page of ordered steps would all lose their order silently, and the
  archive would record something the source never said. Order is meaningful in general.
- **Compare semantically inside `LakeStore`** -- treat two payloads as equal when they differ only
  in array order. The store would need to know which arrays are sets, which is a fact about a
  source and belongs to its spec; it would also stop being a store addressed by its bytes, and
  every caller of the one create-only writer, the lake API included, would inherit a rule it
  never asked for.
- **Hash the sorted form but store the bytes as sent.** Two different byte strings would share an
  address, and whichever arrived first would be what the lake holds -- an arbitrary choice that
  re-reading could not reproduce. Storing what is hashed keeps the address honest.
- **Fix it in the HubSpot template code** (a sort in the `hubspot-batch-inputs` reader). A spec is
  configuration; the next source that answers a set as an array would need the same code again.
  The declaration is general and costs one field.
- **Sort by a declared key** (`typeId`, `toObjectId`) rather than by canonical text. Needs a key
  per path and a rule for ties, and an element with no such key would need a guess. The canonical
  text is a total order over any element, with nothing to declare.
