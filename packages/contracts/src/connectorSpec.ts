/**
 * The declarative connector spec: the platform's main user-facing API.
 *
 * A source is configuration, not code. Everything that varied between the hand-written
 * HubSpot and Xero connectors -- base URL, auth, pagination style, entity list, the path
 * to the record id, the response envelope, pacing -- is a field here. Adding a REST
 * source is a YAML file and no migration.
 *
 * The shape is modelled on dlt's REST config, which is proven, without being bound to its
 * implementation. What a spec cannot express does not become a code exception: it goes
 * through the lake write API as an external caller. That escape valve is why `apiVersion`
 * exists and why the format being wrong somewhere is survivable rather than fatal.
 */

import { z } from "zod";

/** A dotted path into a JSON body: `paging.next.link`, `Invoices`, `from.id`. */
const JsonPath = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_$][A-Za-z0-9_$.[\]-]*$/u, "must be a dotted path like 'paging.next.link'");

const Auth = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("bearer"),
    token: z.discriminatedUnion("from", [
      // The token is a sealed per-tenant credential resolved at run time.
      z.object({ from: z.literal("connection") }),
      // For a single-tenant self-hosted install, an env var is enough.
      z.object({ from: z.literal("env"), name: z.string().min(1) }),
    ]),
    /**
     * How the source says that this token may not read one list, when it says so in words.
     *
     * A pasted token carries whatever permissions somebody ticked on the provider's side, and
     * nothing records which: a HubSpot private app's scopes live in HubSpot. So a list the token
     * cannot read is found out on that list's first request, and a run that failed there would
     * lose every list the token CAN read (issue 279). Declared, the runtime turns exactly that
     * answer into `EntityNotGranted`, and the run names the list and its scope as not granted,
     * the way ADR 0073 names a list a recorded grant lacks. Any other failure still raises.
     *
     * Named, never arbitrary, like a body template: what counts as "not granted" is a reading of
     * one provider's error body, and a spec is configuration, not a parser. Declaring it makes
     * `readScope` required on every entity, so a refusal always has a scope to name. ADR 0075.
     */
    grantRefusal: z.enum(["hubspot-missing-scopes"]).optional(),
  }),
  z.object({
    kind: z.literal("oauth2"),
    tokenUrl: z.string().url(),
    /**
     * Xero invalidates the old refresh token the moment it is exchanged. Declared so the
     * runtime knows to persist the rotated token under a row lock *before* using the
     * access token, rather than racing two refreshes into a destroyed connection.
     */
    rotatesRefreshToken: z.boolean().default(false),
    scopes: z.array(z.string()).default([]),
    /**
     * A header carrying the provider's own account id -- e.g. `xero-tenant-id`. This is
     * NOT our `tenant_id`; conflating the two is the defect that meant live Xero had
     * never run against the right organisation.
     */
    accountHeader: z.string().optional(),
  }),
]);

const Pagination = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("json-link"),
    nextPath: JsonPath,
  }),
  z.object({
    kind: z.literal("page-number"),
    param: z.string().default("page"),
    startAt: z.number().int().min(0).default(1),
    // Xero signals "done" with an empty envelope, not a total count.
    stopOn: z.enum(["empty-page", "total-path"]).default("empty-page"),
    totalPath: JsonPath.optional(),
  }),
  z.object({
    kind: z.literal("cursor"),
    cursorPath: JsonPath,
    param: z.string(),
  }),
  z.object({
    kind: z.literal("offset"),
    param: z.string().default("offset"),
    limitParam: z.string().default("limit"),
  }),
]);

const RateLimit = z
  .object({
    /** Minimum spacing between two requests, ms. Xero: 1100. */
    minIntervalMs: z.number().int().min(0).default(0),
    requestsPerMinute: z.number().int().positive().optional(),
    requestsPerDay: z.number().int().positive().optional(),
  })
  .default({});

const Retry = z
  .object({
    attempts: z.number().int().min(1).max(10).default(5),
    on: z.array(z.number().int()).default([429, 500, 502, 503, 504]),
    backoff: z.enum(["exponential", "fixed"]).default("exponential"),
    baseMs: z.number().int().positive().default(500),
    maxMs: z.number().int().positive().default(30_000),
    jitter: z.enum(["full", "none"]).default("full"),
    respectRetryAfter: z.boolean().default(true),
    // Clamp, so a malformed or hostile Retry-After cannot park a run for hours.
    maxRetryAfterMs: z.number().int().positive().default(120_000),
  })
  .default({});

const Guards = z
  .object({
    /** A source yielding nothing is a green run that published an empty table. */
    failOnEmpty: z.boolean().default(true),
    /**
     * HubSpot's search endpoint caps at 10,000 and does not signal truncation. Landing
     * exactly on the cap is almost certainly silent data loss, so treat it as an error.
     */
    failOnExactCount: z.number().int().positive().optional(),
    maxRecords: z.number().int().positive().optional(),
  })
  .default({});

const Incremental = z.object({
  /** Send the high-water mark as a query param, or sort and stop client-side. */
  strategy: z.enum(["query-param", "client-filter", "header"]),
  param: z.string().optional(),
  header: z.string().optional(),
  /**
   * Where the last-modified value lives in a record. Per entity because HubSpot names it
   * `lastmodifieddate` on contacts and `hs_lastmodifieddate` everywhere else, and the
   * wrong name yields a cursor that never advances.
   */
  sourcePath: JsonPath,
  /** `ms-json-date` is `/Date(1573755038314+0000)/`, which Xero writes in every date field. */
  format: z.enum(["iso8601", "epoch-millis", "yyyy-mm-dd", "ms-json-date"]).default("iso8601"),
  /**
   * How the watermark is written into the `param` or `header`. The stored watermark is the
   * source's own text either way; this only changes what is sent.
   *
   * `verbatim` sends that text back. `rfc3339-seconds` sends the instant it names as UTC
   * RFC 3339, rounded down to the second, for a source whose filter reads a different
   * dialect from the one its records are written in: Xero writes `/Date(...)/` and reads
   * `If-Modified-Since` as RFC 3339. Rounding down can only ask for more. ADR 0068.
   */
  send: z.enum(["verbatim", "rfc3339-seconds"]).default("verbatim"),
  /**
   * How old, in hours, the run that last read this list whole may be before the next run reads
   * it whole again, sending no watermark. For a source whose change filter cannot see every
   * change: Xero documents edits that do not move `UpdatedDateUTC`, so `If-Modified-Since`
   * never returns them, and without this a stale value stays until the record changes for some
   * other reason. Absent means the watermark is always trusted. ADR 0080.
   */
  wholeReadAfterHours: z.number().int().positive().optional(),
});

/**
 * A list read in two steps: the list names the records and carries the cursor, and each page's
 * records are then fetched whole by a batch read that takes their ids -- and what to read of
 * them -- in a POST body rather than in the URL.
 *
 * Exists because a list's URL has a ceiling and what a person may ask to read of a record does
 * not: HubSpot names the properties it returns in the list's query string, and a portal's full
 * list of contact properties is longer than any URL it will accept. The batch read answers the
 * same record the list does -- the same shape, under the same id -- so what lands is still one
 * record the source sent, never an assembly of two. ADR 0054, extending ADR 0052.
 *
 * A record the list named and the batch read reports as gone is not landed: it was deleted in
 * between, and the read is then exactly the one that would have started a moment later. Any
 * OTHER shortfall raises -- an id answered by neither a record nor a "not found" is a record lost
 * without a word.
 */
const BatchRead = z.object({
  path: z.string().min(1),
  /** Named, never arbitrary, for the reason `batch-from`'s template is. */
  bodyTemplate: z.enum(["hubspot-batch-read"]),
  /**
   * What to read of each record. The list's own query need not name any of these.
   *
   * There is no `chunkSize`, unlike `batch-from`: how many ids one request may carry is the
   * endpoint's limit, not a choice, so the template carries it. That also keeps this block all
   * strings, which a request key can digest (`canonicalJson` refuses a JavaScript number).
   */
  properties: z.array(z.string().min(1)).min(1),
});

/** A partition's values, keyed and sorted, so two spellings of one partition compare equal. */
function partitionKey(partition: Readonly<Record<string, string>>): string {
  return JSON.stringify(Object.entries(partition).toSorted(([a], [b]) => a.localeCompare(b, "en")));
}

/**
 * A list the source answers in disjoint parts, one query value apart: the same path read once
 * per partition, each partition's values laid over `query`, and the entity is every record any
 * partition names.
 *
 * Exists because a source may keep part of a population out of its default list while other
 * records still point at it. HubSpot lists live and archived records apart (`archived=false`,
 * `archived=true`), and a line item still names the archived product it was sold as, as a company
 * still names the deactivated owner who looked after it. Read as two entities, a record that is archived
 * would move from one stream to the other and every model would have to put the two back
 * together; read as one, it stays one record whose payload says it is archived. ADR 0075.
 *
 * Each partition is read to its end before the next begins, so the entity's listing is a union of
 * complete listings, and `removedWhen: absent` means a record no partition names any more. A
 * two-step read (`batchRead`) sends the partition's values on its batch read as well, because the
 * record it re-reads lives in that partition: HubSpot's batch read answers an archived record as
 * "not found" unless it too is asked with `archived=true`.
 *
 * Optional with no default, so an entity that declares none keeps the request -- and the request
 * key its watermark is stored under (ADR 0072) -- that it had before the field existed.
 */
const Partitions = z
  .array(z.record(z.string(), z.string()))
  .min(2, "one partition is just a query: write its values into `query`")
  .refine(
    (partitions) => partitions.every((partition) => Object.keys(partition).length > 0),
    "a partition with no values reads the same list as `query` alone",
  )
  .refine(
    (partitions) => new Set(partitions.map(partitionKey)).size === partitions.length,
    "two partitions with the same values would read the same records twice",
  );

const Request = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("list"),
    method: z.enum(["GET", "POST"]).default("GET"),
    path: z.string().min(1),
    query: z.record(z.string(), z.string()).default({}),
    partitions: Partitions.optional(),
    body: z.unknown().optional(),
    batchRead: BatchRead.optional(),
  }),
  z.object({
    /**
     * A batch read keyed off ids harvested from another entity. This exists because a
     * relation like HubSpot's deal-to-company associations is a different route with a
     * different shape, and bending it into the object reader is how a connector becomes
     * hundreds of lines of special cases.
     */
    kind: z.literal("batch-from"),
    entity: z.string().min(1),
    idPath: JsonPath,
    chunkSize: z.number().int().min(1).max(1000).default(100),
    path: z.string().min(1),
    bodyTemplate: z.enum(["hubspot-batch-inputs"]),
  }),
]);

/**
 * What a complete read says about a record held for this entity that the read did not name.
 * Absent means nothing: a record stops appearing and stays live in the lake, which is the
 * honest default for a list the spec author cannot vouch for -- a filtered query, a label.
 *
 * - `absent`: this list, read whole, is every live record the source holds, so a record it
 *   no longer names has been removed at source -- archived, deleted, or merged away. Only a
 *   read that listed everything may say so, and the runtime decides which reads those are
 *   (`connector-runtime/src/listing.ts`). A `list` request only.
 * - `parent-removed`: a `batch-from` relation whose records are keyed by the id of the record
 *   they hang off -- HubSpot's deal-to-company links, keyed by the deal -- so each is removed
 *   exactly when that record is, and live again when it is. The referenced entity must itself
 *   be `absent`, or nothing would ever decide.
 *
 * A removal is `raw.records.deleted_at`, never an erasure: the lake keeps every version, and a
 * record listed live again is live again. ADR 0071.
 */
const RemovedWhen = z.enum(["absent", "parent-removed"]);

const Entity = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/u, "entity name must be snake_case"),
  request: Request,
  /** Where the record array lives in the response. Omit if the body *is* the array. */
  envelopePath: JsonPath.optional(),
  /** Upstream identity. A record with no id cannot be upserted or traced -- fatal, never skipped. */
  idPath: JsonPath,
  /** When THEY last changed it. Absent is honest; guessed is not. */
  updatedAtPath: JsonPath.optional(),
  pagination: Pagination.optional(),
  incremental: Incremental.optional(),
  rateLimit: RateLimit.optional(),
  guards: Guards.optional(),
  /**
   * The consent scope the source reads this entity's list under -- one of `auth.scopes`.
   *
   * Per entity, because a consent is not all-or-nothing on the provider's side: Xero reads each
   * list under its own granular scope and refuses one outside the grant with a 401 on that
   * list's request alone. A grant recorded before a scope was added to the consent can still
   * read every other list, so a run reads those and names this one as not granted, rather than
   * failing as a whole or meeting the 401 part-way through (ADR 0073). Required of every entity
   * in a spec whose oauth2 consent names scopes, so no list's scope is left to a guess.
   *
   * On a pasted token (`bearer`) it is the permission the token must carry to read the list,
   * which nobody records -- a HubSpot private app's scopes are ticked in HubSpot. Required when
   * the auth declares a `grantRefusal`, so the run can name what to grant even when the source's
   * refusal names nothing, and so the runbook's scope table has one place to agree with (ADR
   * 0075).
   */
  readScope: z.string().min(1).optional(),
  removedWhen: RemovedWhen.optional(),
});

export const ConnectorSpec = z
  .object({
    apiVersion: z.literal("undercroft.dev/v1"),
    kind: z.literal("Connector"),
    id: z.string().regex(/^[a-z][a-z0-9_-]*$/u, "connector id must be kebab/snake-case"),
    displayName: z.string().min(1),
    baseUrl: z.string().url(),
    auth: Auth,
    defaults: z
      .object({
        headers: z.record(z.string(), z.string()).default({}),
        timeoutMs: z.number().int().positive().default(60_000),
        pagination: Pagination.default({ kind: "none" }),
        rateLimit: RateLimit,
        retry: Retry,
        guards: Guards,
      })
      .default({}),
    entities: z.array(Entity).min(1),
  })
  .superRefine((spec, ctx) => {
    const names = new Set(spec.entities.map((e) => e.name));
    for (const entity of spec.entities) {
      if (entity.request.kind === "batch-from" && !names.has(entity.request.entity)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entities", entity.name, "request", "entity"],
          message: `batch-from references unknown entity '${entity.request.entity}'`,
        });
      }
      const readScopeIssue = readScopeProblem(entity.readScope, spec.auth);
      if (readScopeIssue !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entities", entity.name, "readScope"],
          message: readScopeIssue,
        });
      }
      const refused = removedWhenRefusal(spec.entities, entity);
      if (refused !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entities", entity.name, "removedWhen"],
          message: refused,
        });
      }
    }
  });

/**
 * What is wrong with an entity's `readScope` against the spec's auth, or `null`.
 *
 * A consent that names scopes needs every entity to say which one reads it: an entity without
 * one would be read on any grant and meet the provider's refusal part-way through a run, which
 * is the failure the field exists to prevent. A scope the consent does not ask for could never
 * be granted, so the entity could never be read.
 *
 * A pasted token asks for nothing -- its scopes are ticked at the provider -- so any scope may be
 * named, and one must be when the auth declares how the source refuses a list (`grantRefusal`),
 * so that a refusal always has a scope to name. A spec with neither has no grant to hold a scope
 * against.
 */
function readScopeProblem(readScope: string | undefined, auth: ConnectorAuth): string | null {
  if (auth.kind === "bearer") {
    return readScope === undefined && auth.grantRefusal !== undefined
      ? "a spec that declares a grantRefusal must name the scope each entity is read under"
      : null;
  }
  const consent = auth.kind === "oauth2" ? auth.scopes : [];
  if (readScope === undefined) {
    return consent.length === 0
      ? null
      : "an oauth2 spec that names scopes must name the scope each entity is read under";
  }
  if (!consent.includes(readScope)) {
    return `readScope '${readScope}' is not one of the scopes auth asks for`;
  }
  return null;
}

/**
 * Why this entity's `removedWhen` cannot mean what it says, or `null` when it can. A rule no
 * read could ever act on would sit in a spec looking like a guarantee.
 */
function removedWhenRefusal(
  entities: readonly ConnectorEntity[],
  entity: ConnectorEntity,
): string | null {
  const { removedWhen, request } = entity;
  if (removedWhen === "absent" && request.kind !== "list") {
    return "removedWhen 'absent' needs a list request: only a listing names every live record";
  }
  if (removedWhen !== "parent-removed") {
    return null;
  }
  if (request.kind !== "batch-from") {
    return "removedWhen 'parent-removed' needs a batch-from request: it follows the entity it reads against";
  }
  const parent = entities.find((e) => e.name === request.entity);
  return parent === undefined || parent.removedWhen === "absent"
    ? null
    : `removedWhen 'parent-removed' needs '${request.entity}' to be removedWhen 'absent', or nothing decides a removal`;
}

export type ConnectorSpec = z.infer<typeof ConnectorSpec>;
export type ConnectorEntity = z.infer<typeof Entity>;
export type ConnectorAuth = z.infer<typeof Auth>;
export type ConnectorPagination = z.infer<typeof Pagination>;
