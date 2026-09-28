/**
 * The mailbox as Gmail holds it now, read the way the Undercroft connector reads it: one
 * listing per selected label, unioned, each proven complete by the label's own count; then
 * every message a leg looks at, with `format=full` (bodies left behind by a partial response).
 *
 * "READ TO THE END" IS PROVEN, NOT ASSUMED. A Gmail listing that ends its page tokens proves
 * only that it stopped. Each label's listing is held against the label's own `messagesTotal`
 * (`labels.get`, a separate endpoint); a listing that excludes Spam and Trash is proven by
 * listing again with them and showing that every extra message is in Spam or Trash.
 */

import { mapLimit } from "./concurrency.ts";
import { messageOf, ReconcileError } from "./errors.ts";
import type { FullMessage } from "./gmail.ts";
import type { GmailDeps, MailboxState } from "./gmailCommon.ts";
import { messageKey } from "./keys.ts";

const CONCURRENCY = 10;
/**
 * Gmail's per-user quota is counted in units a minute, and a message read costs 5. The quota a
 * real OAuth project was granted sustained under three reads a second per mailbox (a burst of
 * about a hundred, then 403), far below the published ceiling -- so reads are spaced
 * (`readSpacingMs`, 330 ms by default) and a read lost to the quota is tried once more at the
 * end rather than left as a message the leg cannot judge.
 */
const READ_SPACING_MS = 330;
const READ_CONCURRENCY = 3;
const QUOTA_COOLDOWN_MS = 60_000;
const SPAM_TRASH = new Set(["SPAM", "TRASH"]);
/** How one label's listing was shown to be complete. */
export type ListingProof = "exact_total" | "exact_total_less_spam_trash" | "no";

export interface LabelFact {
  readonly label: string;
  readonly listed: number;
  readonly pages: number;
  readonly exhausted: boolean;
  readonly labelTotal: number | null;
  readonly withSpamTrash: number | null;
  readonly proof: ListingProof;
}

/** What the mailbox holds now, read the way the connector reads it. */
export interface SourceRead {
  /** Message key -> the selected labels it was listed under. */
  readonly listed: ReadonlyMap<string, readonly string[]>;
  /** Every label's listing proven complete. */
  readonly complete: boolean;
  readonly labels: readonly LabelFact[];
  /** Message key -> the message now; null when Gmail answers 404. */
  readonly messages: ReadonlyMap<string, FullMessage | null>;
  /** Message keys whose read failed for a reason other than 404. */
  readonly unreadable: ReadonlySet<string>;
}

/** One label's listing, and the proof that it is complete. */
async function listLabel(
  deps: GmailDeps,
  state: MailboxState,
  label: string,
): Promise<{ ids: readonly string[]; fact: LabelFact }> {
  const google = deps.google[state.name];
  const spamOrTrash = SPAM_TRASH.has(label);
  const walk = await google.listMessages({ labelIds: [label], includeSpamTrash: spamOrTrash });
  const info = await google.label(label);
  const total = info?.messagesTotal ?? null;
  const fact = {
    label,
    listed: walk.items.length,
    pages: walk.pages,
    exhausted: walk.exhausted,
    labelTotal: total,
  };
  if (walk.exhausted && walk.repeats.size === 0 && total === walk.items.length) {
    return { ids: walk.items, fact: { ...fact, withSpamTrash: null, proof: "exact_total" } };
  }
  if (spamOrTrash || !walk.exhausted || total === null) {
    return { ids: walk.items, fact: { ...fact, withSpamTrash: null, proof: "no" } };
  }
  // The listing leaves Spam and Trash out; the label's count may not. Proven when the wider
  // listing reaches the count and every message it adds is in Spam or Trash.
  const wider = await google.listMessages({ labelIds: [label], includeSpamTrash: true });
  const narrow = new Set(walk.items);
  const widerSet = new Set(wider.items);
  const added = wider.items.filter((id) => !narrow.has(id));
  const addedLabels = await mapLimit(added, CONCURRENCY, async (id) => {
    const message = await google.getMessage(id);
    return message?.labelIds ?? [];
  });
  const proven =
    wider.exhausted &&
    wider.items.length === total &&
    walk.items.every((id) => widerSet.has(id)) &&
    addedLabels.every((labels) => labels.some((name) => SPAM_TRASH.has(name)));
  return {
    ids: walk.items,
    fact: {
      ...fact,
      withSpamTrash: wider.items.length,
      proof: proven ? "exact_total_less_spam_trash" : "no",
    },
  };
}

/** Every selected label's listing, unioned by message key, each tried twice before unproven. */
async function listAll(
  deps: GmailDeps,
  state: MailboxState,
): Promise<{ listed: Map<string, string[]>; labels: LabelFact[] }> {
  const listed = new Map<string, string[]>();
  const labels: LabelFact[] = [];
  for (const label of state.labels) {
    let attempt = await listLabel(deps, state, label);
    if (attempt.fact.proof === "no") {
      // A mailbox receives mail while it is listed; one more try before calling it unproven.
      attempt = await listLabel(deps, state, label);
    }
    labels.push(attempt.fact);
    for (const raw of attempt.ids) {
      const key = messageKey(state.name, raw);
      if (key !== null) {
        listed.set(key, [...(listed.get(key) ?? []), label]);
      }
    }
  }
  return { listed, labels };
}

/** Paced message reads for one mailbox, from the session cache when it holds the message. */
class MessageReader {
  readonly unreadable = new Set<string>();
  readonly refusedByQuota = new Set<string>();
  readonly messages = new Map<string, FullMessage | null>();
  /** Keys whose read came from the session cache, so their labels are as old as the cache. */
  readonly cachedKeys = new Set<string>();
  fromCache = 0;
  #done = 0;
  #nextSlot = Date.now();
  readonly #deps: GmailDeps;
  readonly #state: MailboxState;
  readonly #total: number;

  constructor(deps: GmailDeps, state: MailboxState, total: number) {
    this.#deps = deps;
    this.#state = state;
    this.#total = total;
  }

  async read(key: string, fresh = false): Promise<void> {
    const cached = fresh ? undefined : this.#deps.sourceCache?.get(key);
    if (cached !== undefined) {
      this.fromCache += 1;
      this.cachedKeys.add(key);
      this.messages.set(key, cached);
      return;
    }
    this.cachedKeys.delete(key);
    await this.#pace();
    const { name } = this.#state;
    try {
      const message = await this.#deps.google[name].getFull(key.slice(name.length + 1));
      this.#deps.sourceCache?.put(key, message);
      this.messages.set(key, message);
      this.unreadable.delete(key);
      this.refusedByQuota.delete(key);
    } catch (error) {
      this.#deps.progress?.(`${name}: a message was unreadable: ${messageOf(error).slice(0, 120)}`);
      this.unreadable.add(key);
      if (error instanceof ReconcileError && (error.status === 403 || error.status === 429)) {
        this.refusedByQuota.add(key);
      }
    }
  }

  async #pace(): Promise<void> {
    const wait = this.#nextSlot - Date.now();
    this.#nextSlot =
      Math.max(this.#nextSlot, Date.now()) + (this.#deps.readSpacingMs ?? READ_SPACING_MS);
    if (wait > 0) {
      await Bun.sleep(wait);
    }
    this.#done += 1;
    if (this.#done % 2000 === 0) {
      this.#deps.progress?.(
        `${this.#state.name}: ${this.#done}/${this.#total} message(s) read from Gmail`,
      );
    }
  }
}

/**
 * Held messages the live listing no longer returns, whose CACHED read still carries a selected
 * label and no Trash. The listing is live and the cached labels are as old as the cache, so the
 * two disagree only when the labels moved since the read -- a message trashed or archived after
 * it was cached. Judging such a message on its cached labels makes a policy-retained message
 * undecidable; it is read again, live, instead.
 */
function contradictedByListing(
  state: MailboxState,
  listed: ReadonlyMap<string, unknown>,
  reader: MessageReader,
): string[] {
  const scope = new Set(state.labels);
  return [...state.byKey.keys()].filter((key) => {
    const message = reader.messages.get(key);
    return (
      !listed.has(key) &&
      reader.cachedKeys.has(key) &&
      message !== undefined &&
      message !== null &&
      !message.labelIds.includes("TRASH") &&
      message.labelIds.some((label) => scope.has(label))
    );
  });
}

/**
 * Every label's listing, then every message a leg will look at, read as the connector reads
 * it: the listed ones, the lake's own rows, and the messages the lake's documents name.
 */
export async function readSource(
  deps: GmailDeps,
  state: MailboxState,
  documentMessages: readonly string[],
): Promise<SourceRead> {
  const { listed, labels } = await listAll(deps, state);
  const wanted = [...new Set([...listed.keys(), ...state.byKey.keys(), ...documentMessages])];
  const reader = new MessageReader(deps, state, wanted.length);
  await mapLimit(wanted, READ_CONCURRENCY, (key) => reader.read(key));
  deps.progress?.(
    `${state.name}: ${wanted.length} message(s) read, ${reader.fromCache} from this session's cache`,
  );
  if (reader.refusedByQuota.size > 0) {
    deps.progress?.(
      `${state.name}: ${reader.refusedByQuota.size} read(s) refused by the quota; one more try after a pause`,
    );
    await Bun.sleep(QUOTA_COOLDOWN_MS);
    await mapLimit([...reader.refusedByQuota], 1, (key) => reader.read(key));
  }
  const stale = contradictedByListing(state, listed, reader);
  if (stale.length > 0) {
    deps.progress?.(
      `${state.name}: ${stale.length} cached read(s) disagree with the live listing; read again`,
    );
    await mapLimit(stale, READ_CONCURRENCY, (key) => reader.read(key, true));
  }
  for (const key of reader.unreadable) {
    reader.messages.delete(key);
  }
  return {
    listed,
    complete: labels.length > 0 && labels.every((fact) => fact.proof !== "no"),
    labels,
    messages: reader.messages,
    unreadable: reader.unreadable,
  };
}
