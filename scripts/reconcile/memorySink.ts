/**
 * An evidence sink that keeps everything in memory, for the offline suite: a test can assert
 * what a case would have written without touching the file system.
 */

import { type EvidenceSink, evidenceFile } from "./evidence.ts";

export class MemorySink implements EvidenceSink {
  readonly files = new Map<string, unknown>();

  rows(name: string, rows: readonly unknown[]): string {
    const relative = `evidence/${evidenceFile(name, "jsonl")}`;
    this.files.set(relative, rows);
    return relative;
  }

  json(name: string, value: unknown): string {
    const relative = `evidence/${evidenceFile(name, "json")}`;
    this.files.set(relative, value);
    return relative;
  }
}
