/**
 * An archive's members landed as documents of their own, by the extract pass that read it.
 * ADR 0108.
 *
 * THROUGH THE INGEST'S OWN DOCUMENT SINK, so a member's bytes enter the lake by the one
 * create-only path every document takes, its catalogue row is written by the one function that
 * writes them, and the size ceiling is the one every document meets (`documentSink.ts`). This
 * file adds only what is true of a member: its id is its archive's plus its position, its
 * name goes to the lake manifest and nowhere else, and it lands under every document holding
 * the archive's digest -- a pass reads a digest once.
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
import type { DocumentLanding } from "../landing.ts";
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

function memberId(archiveId: string, member: ArchiveMember): string {
  return `${archiveId}/${String(member.position)}`;
}

/** A member's bytes inflated once, however many documents hold its archive. */
function inflatedOnce(member: ArchiveMember): () => Promise<Uint8Array> {
  let bytes: Uint8Array | null | undefined;
  return (): Promise<Uint8Array> => {
    if (bytes === undefined) {
      bytes = member.bytes();
    }
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

  async function landMember(holders: readonly string[], member: ArchiveMember): Promise<void> {
    const fetchBytes = inflatedOnce(member);
    for (const archiveId of holders) {
      await sink.add({
        documentId: memberId(archiveId, member),
        contentType: member.type,
        declaredBytes: member.declaredBytes,
        metadata: { archiveDocumentId: archiveId, archiveMember: member.position },
        manifest: { filename: member.name },
        sourceUpdatedAt: null,
        fetchBytes,
      });
    }
    await sink.flush();
  }

  return {
    async land(archive, contents): Promise<void> {
      const holders = await documentsHolding(deps.exec, identity, archive.sha256);
      const kept: string[] = [];
      leftInArchive += contents.leftInArchive * holders.length;
      for (const member of contents.members) {
        if (member.refusal === null) {
          await landMember(holders, member);
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
