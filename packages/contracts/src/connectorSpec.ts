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
  format: z.enum(["iso8601", "epoch-millis", "yyyy-mm-dd"]).default("iso8601"),
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

const Request = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("list"),
    method: z.enum(["GET", "POST"]).default("GET"),
    path: z.string().min(1),
    query: z.record(z.string(), z.string()).default({}),
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
    }
  });

export type ConnectorSpec = z.infer<typeof ConnectorSpec>;
export type ConnectorEntity = z.infer<typeof Entity>;
export type ConnectorAuth = z.infer<typeof Auth>;
export type ConnectorPagination = z.infer<typeof Pagination>;
