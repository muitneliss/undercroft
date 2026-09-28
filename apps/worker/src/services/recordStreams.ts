/**
 * One record sink per entity, for a caller whose records arrive as more than one stream.
 *
 * A record sink already lands and projects a chunk per entity, but it counts every record it
 * was given as one. A Drive walk lands `files` and `folders` (ADR 0078), and a run that counted
 * both under `files` would say it landed files it never read. So each entity gets its own sink
 * and its own counts, and the caller's own entity is reported apart from the rest.
 */

import type { HarvestedRecord, Landing, LandSummary, RecordSink, SinkDeps } from "./landing.ts";
import { createRecordSink } from "./recordSink.ts";

/** Another record stream a caller landed, beside its own entity's. */
export type AlongsideSummary = { readonly entity: string } & LandSummary;

/** The caller's own entity's summary, and every other stream's beside it. */
export interface StreamsLanded {
  readonly records: LandSummary;
  readonly alongside: readonly AlongsideSummary[];
}

export interface RecordStreams {
  readonly add: (record: HarvestedRecord) => Promise<void>;
  readonly close: () => Promise<StreamsLanded>;
}

/**
 * The caller's own entity's sink is opened at once, so a run that lands nothing still reports
 * that entity with zeroes; any other opens as its first record arrives.
 */
export function createRecordStreams(
  deps: SinkDeps,
  at: Landing & { readonly entity: string },
): RecordStreams {
  const own = createRecordSink(deps, at);
  const others = new Map<string, RecordSink>();
  function sinkFor(entity: string): RecordSink {
    if (entity === at.entity) {
      return own;
    }
    const existing = others.get(entity);
    if (existing !== undefined) {
      return existing;
    }
    const sink = createRecordSink(deps, at);
    others.set(entity, sink);
    return sink;
  }
  return {
    add: (record): Promise<void> => sinkFor(record.entity).add(record),
    async close(): Promise<StreamsLanded> {
      const records = await own.close();
      const alongside: AlongsideSummary[] = [];
      for (const [entity, sink] of others) {
        alongside.push({ entity, ...(await sink.close()) });
      }
      return { records, alongside };
    },
  };
}
