/**
 * An archive's members landed as documents of their own, by the extract pass that read it.
 * ADR 0108.
 *
 * THROUGH THE INGEST'S OWN DOCUMENT SINK, so a member's bytes enter the lake by the one
 * create-only path every document takes, its catalogue row is written by the one function that
 * writes them, and the size ceiling is the one every document meets (`documentSink.ts`). This
 * file adds only what is true of a member: its id is its archive's plus its position, its
 * name is its path inside the archive and its link is the archive's (ADR 0161), and it lands
 * under every document holding the archive's digest -- a pass reads a digest once.
 *
 * ONE MEMBER'S BYTES AT A TIME. The sink is flushed after each member, so the pass holds one
 * inflated member however many an archive has, under the `--smol` heap a read is sized for.
 */

import type { SqlExecutor } from "@undercroft/db";
import type { RunRefusal } from "@undercroft/db/repos";
import type { LakeStore } from "@undercroft/lake";

import {
  type DocumentIdentity,
  documentsHolding,
  tombstoneStaleMembers,
} from "../../repos/rawDocuments.ts";
import { createDocumentSink, DOCUMENT_ENTITY } from "../documentSink.ts";
import type { DocumentLanding, DocumentSink } from "../landing.ts";
import type { RunJournal } from "../runJournal.ts";
import { type Archive, type ArchiveMember, MEMBER_UNREADABLE } from "./archive.ts";

/** What landing the members of a pass's archives came to. */
export interface MembersLanded {
  /** Members in the lake with a catalogue row, first seen or not. */
  readonly landed: number;
  /** The part of `landed` the lake stored for the first time. */
  readonly created: number;
  /** Members left in their archives because the catalogue knows no format by their name. */
  readonly leftInArchive: number;
  /** Every member that did not land, against its own id, with why. */
  readonly refusals: readonly RunRefusal[];
}

export interface ArchiveLander {
  /** Land what one archive holds, under every document holding its bytes. */
  readonly land: (archive: { readonly sha256: string }, contents: Archive) => Promise<void>;
  /** Land anything still held, and say -- to the journal, in counts -- what came of every member. */
  readonly finish: () => Promise<MembersLanded>;
}

/** A document holding an archive's bytes, and where it is opened at the source. */
type Holder = Awaited<ReturnType<typeof documentsHolding>>[number];

function memberId(archiveId: string, member: ArchiveMember): string {
  return `${archiveId}/${String(member.position)}`;
}

/** A member's bytes inflated once, however many documents hold its archive. */
function inflatedOnce(member: ArchiveMember): () => Promise<Uint8Array> {
  // Boxed, so "not inflated yet" (no box) cannot be read as "inflated, and unreadable" (a box
  // holding null): a member that would not inflate is not tried again for the next document
  // that holds it.
  let inflated: { readonly bytes: Uint8Array | null } | undefined;
  return (): Promise<Uint8Array> => {
    inflated ??= { bytes: member.bytes() };
    const { bytes } = inflated;
    // Raised rather than returned: the sink records a failed fetch as a refusal, by this name.
    return bytes === null ? Promise.reject(new Error(MEMBER_UNREADABLE)) : Promise.resolve(bytes);
  };
}

/** A member that will not land, refused against its id under each document holding it. */
function refusedUnder(
  holders: readonly string[],
  member: ArchiveMember,
  reason: string,
): RunRefusal[] {
  return holders.map((archiveId) => ({
    entity: DOCUMENT_ENTITY,
    sourceRecordId: memberId(archiveId, member),
    reason,
  }));
}

/**
 * One member landed under every document holding its archive, then flushed: one inflated member
 * held at a time. It is named by its path inside the archive and opened through the archive's
 * own link -- the source holds the archive, not the member, so that is where a person finds it
 * (ADR 0161).
 */
async function landMember(
  sink: DocumentSink,
  holders: readonly Holder[],
  member: ArchiveMember,
): Promise<void> {
  const fetchBytes = inflatedOnce(member);
  for (const holder of holders) {
    await sink.add({
      documentId: memberId(holder.documentId, member),
      contentType: member.type,
      declaredBytes: member.declaredBytes,
      metadata: { archiveDocumentId: holder.documentId, archiveMember: member.position },
      fileName: member.name,
      link: holder.sourceUrl,
      manifest: {},
      sourceUpdatedAt: null,
      fetchBytes,
    });
  }
  await sink.flush();
}

export function archiveLander(
  deps: { readonly lake: LakeStore; readonly exec: SqlExecutor; readonly journal: RunJournal },
  at: DocumentLanding,
): ArchiveLander {
  const refusals: RunRefusal[] = [];
  const identity: DocumentIdentity = { source: at.source, tenantId: at.tenantId };
  const sink = createDocumentSink(
    {
      ...deps,
      refuse: (rows): Promise<void> => {
        refusals.push(...rows);
        return Promise.resolve();
      },
    },
    at,
  );
  let leftInArchive = 0;

  return {
    async land(archive, contents): Promise<void> {
      const holding = await documentsHolding(deps.exec, identity, archive.sha256);
      const holders = holding.map((holder) => holder.documentId);
      const kept: string[] = [];
      leftInArchive += contents.leftInArchive * holders.length;
      for (const member of contents.members) {
        if (member.refusal === null) {
          await landMember(sink, holding, member);
          kept.push(...holders.map((archiveId) => memberId(archiveId, member)));
        } else {
          refusals.push(...refusedUnder(holders, member, member.refusal));
        }
      }
      await tombstoneStaleMembers(deps.exec, identity, {
        archiveIds: holders,
        keptIds: kept,
        observedAt: at.observedAt,
      });
    },
    async finish(): Promise<MembersLanded> {
      const summary = await sink.close();
      deps.journal.info("archive_members_landed", {
        entity: DOCUMENT_ENTITY,
        landed: summary.landed,
        created: summary.created,
        refused: refusals.length,
        left: leftInArchive,
      });
      return { landed: summary.landed, created: summary.created, leftInArchive, refusals };
    },
  };
}
