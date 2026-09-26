/**
 * The two Drive ingestion failures reported upstream, as live regressions over the run ledger:
 * a NUL byte in extracted text failing the batch insert (#218), and a worker stopped mid-run
 * (#219). Each case fails while any run in the window still ends that way.
 */

import { makeCase } from "./cases.ts";
import type { DriveDeps } from "./driveLake.ts";
import type { TestResult } from "./model.ts";
import type { Run } from "./undercroft.ts";

const NUL_ERROR = /0x00|invalid byte sequence/u;
const WORKER_STOPPED = /worker (?:was shut down|stopped abruptly)/u;

function ledgerCase(
  deps: Pick<DriveDeps, "sink">,
  runs: readonly Run[],
  spec: {
    id: string;
    title: string;
    pattern: RegExp;
    finding: string;
    contract: string;
    requirement: string;
  },
): TestResult {
  const hits = runs.filter((run) => run.status === "failed" && spec.pattern.test(run.error ?? ""));
  const window =
    runs.length === 0 ? "none" : `${runs.at(-1)?.startedAt ?? "?"} .. ${runs[0]?.startedAt ?? "?"}`;
  const cited = hits.map((run) => ({
    id: run.id,
    source: run.source,
    startedAt: run.startedAt,
    error: run.error,
  }));
  return makeCase(
    "drive",
    { id: spec.id, title: spec.title },
    {
      group: "regression",
      requirement: spec.requirement,
      contract: spec.contract,
      finding: spec.finding,
      preconditions: `last ${runs.length} runs (${window})`,
      expected: "0 runs failed this way",
      actual: `${hits.length} run(s) failed this way`,
      status: hits.length === 0 ? "PASS" : "FAIL",
      reason:
        hits.length === 0
          ? ""
          : `${hits.length} run(s) in the window: ${spec.title.toLowerCase()} does not yet hold`,
      evidence: [{ label: "runs", path: deps.sink.json(spec.id, cited) }],
    },
  );
}

/** #218 and #219 as live regressions: the run ledger must stop showing either failure. */
export function runLedgerCases(deps: Pick<DriveDeps, "sink">, runs: readonly Run[]): TestResult[] {
  return [
    ledgerCase(deps, runs, {
      id: "DR-U-REG-218",
      title: "No ingest run fails on a NUL byte in extracted text",
      pattern: NUL_ERROR,
      finding: "undercroft issue #218",
      contract: "worker extract batch INSERT must not carry 0x00",
      requirement: "REQ-DR-05 every stored document is read or refused with a reason",
    }),
    ledgerCase(deps, runs, {
      id: "DR-U-REG-219",
      title: "No ingest run is lost to the worker being stopped mid-run",
      pattern: WORKER_STOPPED,
      finding: "undercroft issue #219",
      contract: "worker survives large Drive runs (memory)",
      requirement: "REQ-GEN-03 an ingest run completes or fails for a reason of its own",
    }),
  ];
}
