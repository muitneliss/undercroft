/**
 * What both read paths share: the process and HTTP seams, JSON narrowing, and a paged walk that
 * says whether it reached the end.
 *
 * EVERY LISTING IS READ TO ITS END. `lake records`, `lake documents`, `runs list` and each Drive
 * folder listing are walked until the source offers no further cursor; a repeated cursor or an
 * id delivered twice is counted, so a short read shows instead of passing as "the lake holds N".
 * A shape the systems change is an error, never a silently dropped row.
 */

export interface CommandRunner {
  run: (argv: readonly string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
}

export interface HttpReply {
  readonly status: number;
  text: () => Promise<string>;
  /** The body, chunk by chunk, read once. */
  chunks: () => AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
}

export interface Http {
  send: (
    url: string,
    init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string },
  ) => Promise<HttpReply>;
}

/** A runner over real processes; the CLI must be on `PATH`. */
export const spawnRunner: CommandRunner = {
  async run(argv): Promise<{ code: number; stdout: string; stderr: string }> {
    const child = Bun.spawn([...argv], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { code, stdout, stderr };
  },
};

/**
 * Bun's native fetch. The test runner preloads happy-dom (`bunfig.toml`), whose global `fetch`
 * refuses a cross-origin call; `Bun.fetch` is the runtime's own client, untouched by it.
 */
export const bunHttp: Http = {
  async send(url, init): Promise<HttpReply> {
    const response = await Bun.fetch(url, init);
    return {
      status: response.status,
      text: (): Promise<string> => response.text(),
      chunks: (): AsyncIterable<Uint8Array> | Iterable<Uint8Array> => response.body ?? [],
    };
  },
};

function preview(value: unknown): string {
  return String(JSON.stringify(value)).slice(0, 80);
}

export function obj(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`expected an object, got ${preview(value)}`);
  }
  return Object.fromEntries(Object.entries(value));
}

/** An optional array: absent and null read as empty, anything else must be an array. */
export function list(value: unknown): readonly unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`expected an array, got ${preview(value)}`);
  }
  return value;
}

export function str(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

export function strOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** A count sent as a number or as decimal text. */
export function int(value: unknown): number {
  return typeof value === "number" ? value : Number.parseInt(str(value) || "0", 10);
}

/** Run `fn` over `items`, at most `limit` at once, keeping order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  const queue = items.entries();
  async function worker(): Promise<void> {
    for (const [index, item] of queue) {
      out[index] = await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

export interface Listing<T> {
  readonly items: readonly T[];
  /** The source said there was nothing further: the only state that proves the read whole. */
  readonly exhausted: boolean;
  /** Ids delivered more than once. */
  readonly repeats: number;
}

const RUNAWAY_PAGES = 100_000;

/** Walk a cursor-paged listing to its end, keeping each id once. */
export async function walk<T>(
  page: (cursor: string | null) => Promise<{ items: readonly T[]; next: string | null }>,
  idOf: (item: T) => string,
): Promise<Listing<T>> {
  const byId = new Map<string, T>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  let repeats = 0;
  for (let pages = 0; pages < RUNAWAY_PAGES; pages += 1) {
    const { items, next } = await page(cursor);
    for (const item of items) {
      repeats += byId.has(idOf(item)) ? 1 : 0;
      byId.set(idOf(item), item);
    }
    if (next === null || next.length === 0) {
      return { items: [...byId.values()], exhausted: true, repeats };
    }
    if (cursors.has(next)) {
      break;
    }
    cursors.add(next);
    cursor = next;
  }
  return { items: [...byId.values()], exhausted: false, repeats };
}
