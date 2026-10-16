/**
 * Tenant access, defined once: the built-in role keys, the permissions a role can hold, and
 * which built-in holds which. ADR 0139.
 *
 * The control plane projects `BUILT_IN_GRANTS` into Casbin and Casbin evaluates
 * (`apps/control-plane/src/services/rbac.ts`); the rest is what the wire carries and every side
 * must spell the same way -- the zod enum a role is accepted through, the roster a browser
 * offers, the `permissions` array `tenants.get` answers with.
 *
 * The grants are here, below every layer, rather than in the control plane, so that one table is
 * the policy for the server AND for the browser's test fixtures, which stand in for the server's
 * answer and would otherwise carry a second copy of it that nothing kept true. The browser's
 * product code never reads the table: it reads a caller's rights from `tenants.get`, through
 * `can()`, and `.ast-grep/rules/no-role-literal-gate.yml` fails the gate on a
 * `BUILT_IN_GRANTS` anywhere under `apps/ui/src` outside a test -- a browser that computed
 * rights from a role would be wrong for every role a customer defines (PR 2).
 *
 * Its own entry point rather than a line in `index.ts`, for the reason CLAUDE.md gives about
 * `@undercroft/core/locale`: the root barrel reaches `node:fs`, which a browser bundle refuses.
 * This file imports nothing.
 */

/**
 * The roles every customer has, in order of how much each holds. A customer may define more of its
 * own (ADR 0141), stored in its tables; these four are code, and cannot be changed or deleted. The values are the words every
 * surface prints, untranslated in both languages (`.claude/rules/i18n.md`).
 *
 * `builder` is ADR 0139's: the person who fixes the dbt project -- models, macros, reference
 * tables, the raw lake they read -- without the people, the sources, the keys or the customer
 * itself, which stay an admin's (issue 481).
 */
export const BUILT_IN_ROLES = ["viewer", "member", "builder", "admin"] as const;
export type BuiltInRole = (typeof BUILT_IN_ROLES)[number];

/**
 * The shape of every role key, a built-in's or one a customer defines (ADR 0141): a lowercase
 * identifier of at most `MAX_ROLE_KEY_CHARS`. Never a colon, because a Casbin subject for a
 * person is `user:<uuid>` and a role key must never read as one. The database's CHECK on
 * `app.access_role.key` says the same (`600_custom_roles.sql`); this is the copy every door
 * validates with before a request reaches it.
 */
export const ROLE_KEY = /^[a-z][a-z0-9_]*$/u;
export const MAX_ROLE_KEY_CHARS = 63;

/**
 * The role the last-admin guard protects. Named once, because the guard is the one place a role
 * key is a fact about the database rather than a bundle of permissions: a customer must keep
 * somebody holding it, or nobody is left who may manage access.
 */
export const ADMIN_ROLE = "admin" satisfies BuiltInRole;

/**
 * Every permission the platform checks, as `area:action`. A procedure past `tenantProcedure`
 * that changes or reveals more than any member may see declares exactly one of these.
 *
 * A permission is added here together with its words in both catalogues,
 * `docs/reference/permissions.md` and `skills/undercroft/references/access-control.md`
 * (`.claude/rules/access.md`); the compiler then demands the rest, because each catalogue's
 * labels are typed `Record<Permission, …>`.
 */
export const PERMISSIONS = [
  "reports:author",
  "models:write",
  "lake:read",
  "sources:manage",
  "keys:manage",
  "catalogue:manage",
  "people:manage",
  "audit:read",
  "tenant:manage",
  "roles:manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * What each built-in role holds: the policy statement `ROLE_RANK` used to be.
 *
 * Flat sets rather than a ladder of roles inheriting from each other. A ladder is what ADR 0139
 * replaced: `builder` holds `models:write` and not `people:manage`, `member` holds
 * `reports:author` and neither, and no ordering of four rungs says that. A customer's own roles
 * (PR 2) are flat sets too, so the built-ins are simply the four that ship.
 *
 * `admin` is "all of the catalogue" by construction rather than by list, so a permission added
 * tomorrow reaches the customer's admins the moment it exists -- the alternative is a permission
 * nobody can exercise until somebody remembers to grant it to the role that manages everything
 * else. `docs/reference/permissions.md` lists the procedures each permission covers.
 */
export const BUILT_IN_GRANTS: Readonly<Record<BuiltInRole, readonly Permission[]>> = {
  viewer: [],
  member: ["reports:author"],
  builder: ["reports:author", "models:write", "lake:read"],
  admin: PERMISSIONS,
};

const BUILT_IN_ROLE_SET: ReadonlySet<string> = new Set(BUILT_IN_ROLES);
const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export function isBuiltInRole(value: string): value is BuiltInRole {
  return BUILT_IN_ROLE_SET.has(value);
}

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

/** Whether a string has the shape of a role key; whether a customer HAS it is the server's. */
export function isRoleKey(value: string): boolean {
  return value.length <= MAX_ROLE_KEY_CHARS && ROLE_KEY.test(value);
}

// -- object reach (ADR 0142) ------------------------------------------------------------------

/**
 * The three kinds of thing a person can be given to READ, beside the permissions above: a model
 * or a reference table (`model:`), a raw stream (`raw:`), and a saved report (`report:`). A grant
 * of one is a Casbin `p` line like a permission's, with the action `read` where a permission's is
 * `use` (`apps/control-plane/src/services/rbac.ts`). ADR 0142.
 *
 * A permission says what a person may DO -- author a report, read the raw lake at all; an object
 * grant says WHICH of the customer's things they may do it to. The two compose: reading a raw
 * stream needs `lake:read` and the stream's reach, and neither alone is enough.
 */
export const REACH_DOMAINS = ["model", "raw", "report"] as const;
export type ReachDomain = (typeof REACH_DOMAINS)[number];

/** The action every object grant names. A permission is granted with `use`. */
export const READ_ACTION = "read";
/** The action a permission is granted and asked with. */
export const USE_ACTION = "use";

/**
 * The object grammar, one pattern per domain, each anchored. `*` appears only where it means the
 * whole of something -- `model:*`, `raw:*`, `raw:<source>/*`, `report:*` -- and never inside a
 * name, so no stored object can reach Casbin's `keyMatch` as a pattern wider than it reads. The
 * database's CHECK says the same (`access_grant_object_shape`, `610_object_grants.sql`).
 *
 * - **model**: a model's or a reference table's name, `MODEL_NAME`'s grammar (a seed is a model
 *   to a reader: both are a table in the customer's analytics schema).
 * - **raw**: `<source>/<entity>`. A slash and not a dot, because a source names its account with
 *   a dot (`gmail.3fa9c1d2e0ab`, ADR 0043): `raw:gmail.*` would have reached every mailbox. The
 *   source is a source instance (`sourceInstance.ts`); the entity is anything but `*` and a
 *   control character, as long as `lake.records` takes. A document catalogue is the entity
 *   `documents`, the name a run's ledger counts it under.
 * - **report**: `question:<uuid>` or `dashboard:<uuid>`. Read in either case and written in lower
 *   case, as Postgres prints a uuid (`reachObjectText`), so the grant and the row compare as text.
 */
const MODEL_OBJECT = /^model:(?:\*|(?<name>[a-z][a-z0-9_]{0,62}))$/u;
const RAW_OBJECT =
  /^raw:(?:\*|(?<source>[a-z][a-z0-9_-]{0,63}(?:\.[0-9a-f]{12})?)\/(?:\*|(?<entity>[^*\p{Cc}]{1,128})))$/u;
const REPORT_OBJECT =
  /^report:(?:\*|(?<kind>question|dashboard):(?<id>[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}))$/u;

/** The entity a source's document catalogue is reached as: `raw:gmail/documents`. */
export const DOCUMENTS_ENTITY = "documents";

/** The kinds of saved report: a question, or a dashboard of them. */
export type ReportKind = "question" | "dashboard";

/** A grant's object, read; `null` where it names the whole of something. */
export type ReachObject =
  | { readonly domain: "model"; readonly name: string | null }
  /** `source` null is `raw:*`; `entity` null with a source is `raw:<source>/*`. */
  | { readonly domain: "raw"; readonly source: string | null; readonly entity: string | null }
  | {
      readonly domain: "report";
      readonly report: { readonly kind: ReportKind; readonly id: string } | null;
    };

/** A grant's object read by the grammar above, or `null` for one it does not admit. */
export function parseReachObject(object: string): ReachObject | null {
  const model = MODEL_OBJECT.exec(object);
  if (model !== null) {
    return { domain: "model", name: model.groups?.name ?? null };
  }
  const raw = RAW_OBJECT.exec(object);
  if (raw !== null) {
    const source = raw.groups?.source ?? null;
    return { domain: "raw", source, entity: source === null ? null : (raw.groups?.entity ?? null) };
  }
  const report = REPORT_OBJECT.exec(object);
  if (report !== null) {
    const kind = report.groups?.kind;
    const id = report.groups?.id;
    // The pattern admits these two kinds or none; a match with neither is the wildcard alone.
    if (kind === undefined || id === undefined) {
      return { domain: "report", report: null };
    }
    return {
      domain: "report",
      report: { kind: kind === "dashboard" ? "dashboard" : "question", id: id.toLowerCase() },
    };
  }
  return null;
}

/** An object as the grammar writes it -- a uuid in lower case -- whatever case it was read in. */
export function reachObjectText(object: ReachObject): string {
  switch (object.domain) {
    case "model":
      return object.name === null ? wholeObject("model") : modelObject(object.name);
    case "raw":
      return object.source === null ? wholeObject("raw") : rawObject(object.source, object.entity);
    default:
      return object.report === null
        ? wholeObject("report")
        : reportObject(object.report.kind, object.report.id);
  }
}

/** The object that names the whole of a domain: `model:*`. */
export function wholeObject(domain: ReachDomain): string {
  return `${domain}:*`;
}

export function modelObject(name: string): string {
  return `model:${name}`;
}

/** A raw stream's object, or a whole source's with `entity` null. */
export function rawObject(source: string, entity: string | null): string {
  return `raw:${source}/${entity ?? "*"}`;
}

export function reportObject(kind: ReportKind, id: string): string {
  return `report:${kind}:${id.toLowerCase()}`;
}

/**
 * What a person may read, as Casbin decided it over every object their policy names (ADR 0142):
 * the whole of a domain, or the named things in it. It is an ANSWER, computed by the control
 * plane on each request; the browser and an agent read it from `grants.reach` and never derive
 * one.
 *
 * A raw stream is reached through a grant on it, a grant on its whole source, or `raw:*`. A
 * stream whose source is outside the grammar (one a script landed under a name no connector
 * has) is reached only through `raw:*`.
 */
export interface Reach {
  readonly models: "all" | readonly string[];
  readonly raw:
    | "all"
    | {
        /** Sources reached whole. */
        readonly sources: readonly string[];
        readonly streams: readonly { readonly source: string; readonly entity: string }[];
      };
  readonly reports:
    | "all"
    | { readonly questions: readonly string[]; readonly dashboards: readonly string[] };
}

/** Everything: what every built-in role reaches. */
export const WHOLE_REACH: Reach = { models: "all", raw: "all", reports: "all" };

export function reachesModel(reach: Reach, name: string): boolean {
  return reach.models === "all" || reach.models.includes(name);
}

export function reachesStream(reach: Reach, source: string, entity: string): boolean {
  return (
    reach.raw === "all" ||
    reach.raw.sources.includes(source) ||
    reach.raw.streams.some((stream) => stream.source === source && stream.entity === entity)
  );
}

export function reachesReport(reach: Reach, kind: ReportKind, id: string): boolean {
  if (reach.reports === "all") {
    return true;
  }
  const ids = kind === "question" ? reach.reports.questions : reach.reports.dashboards;
  return ids.includes(id.toLowerCase());
}

/** Whether `reach` holds the whole of `domain`. */
export function reachesWhole(reach: Reach, domain: ReachDomain): boolean {
  switch (domain) {
    case "model":
      return reach.models === "all";
    case "raw":
      return reach.raw === "all";
    default:
      return reach.reports === "all";
  }
}

/**
 * Whether `reach` covers everything `object` names: the subset rule's question for an object
 * grant (ADR 0141, ADR 0142). A wildcard is covered only by the same wildcard or a wider one, so
 * a person who reaches three models cannot grant `model:*`.
 */
export function covers(reach: Reach, object: ReachObject): boolean {
  switch (object.domain) {
    case "model":
      return object.name === null ? reach.models === "all" : reachesModel(reach, object.name);
    case "raw":
      if (object.source === null || reach.raw === "all") {
        return reach.raw === "all";
      }
      return object.entity === null
        ? reach.raw.sources.includes(object.source)
        : reachesStream(reach, object.source, object.entity);
    default:
      return object.report === null
        ? reach.reports === "all"
        : reachesReport(reach, object.report.kind, object.report.id);
  }
}

/**
 * A reach written out as the objects that would grant it, wildcards first: what the subset rule
 * weighs when a person is given a role or removed, and what a reader is told they reach.
 */
export function reachObjects(reach: Reach): string[] {
  const models = reach.models === "all" ? [wholeObject("model")] : reach.models.map(modelObject);
  const raw =
    reach.raw === "all"
      ? [wholeObject("raw")]
      : [
          ...reach.raw.sources.map((source) => rawObject(source, null)),
          ...reach.raw.streams.map((stream) => rawObject(stream.source, stream.entity)),
        ];
  const reports =
    reach.reports === "all"
      ? [wholeObject("report")]
      : [
          ...reach.reports.questions.map((id) => reportObject("question", id)),
          ...reach.reports.dashboards.map((id) => reportObject("dashboard", id)),
        ];
  return [...models, ...raw, ...reports];
}

/**
 * The objects of `involved` that `held` does not cover, in `reachObjects` order: empty when a
 * holder of `held` may give or take away everything `involved` reaches (ADR 0142).
 */
export function unreached(held: Reach, involved: Reach): string[] {
  return reachObjects(involved).filter((object) => {
    const parsed = parseReachObject(object);
    return parsed === null || !covers(held, parsed);
  });
}
