import type { Words } from "./types.ts";

export interface EngineeringProfile {
  owner: string;
  key: string[];
  caveat: Words;
  relation: string;
  path: string;
  uniqueId: string;
  tags: string[];
  contract: Words;
  access: string;
  measuredAt: string;
  environment: string;
  sqlComparison: Words;
  tests: { name: string; status: "pass" | "warn" | "fail"; failures: number; explanation: Words }[];
  runs: {
    id: string;
    at: string;
    status: "success" | "failed";
    durationMs: number;
    explanation: Words;
  }[];
}
export interface ModelDetails {
  columns: { name: string; type: string; description: { vi: string; en: string } }[];
  sql: string | null;
  materialization: string | null;
  durationMs: number | null;
  rowCount: string | null;
  engineering?: EngineeringProfile;
}
export interface SampleCell {
  text: string | null;
  currency?: string;
}
export interface ModelSample {
  columns: string[];
  rows: SampleCell[][];
}
export interface ProfileSource {
  details: (id: string, signal: AbortSignal) => Promise<ModelDetails | null>;
  sample: (id: string, signal: AbortSignal) => Promise<ModelSample | null>;
}
