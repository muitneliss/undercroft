export type Layer = "input" | "transform" | "output" | "unclassified";
export type Direction = "up" | "down" | "both";
export interface Words {
  vi: string;
  en: string;
}
export interface ModelRecord {
  id: string;
  title: Words;
  description: Words;
  grain: Words | null;
  layer: Layer;
  domain: string | null;
  sources: string[];
  coverage: "complete" | "partial" | "unknown";
  family: string | null;
  status: "success" | "failed" | "never" | "running" | "queued";
  builtAt: string | null;
}
export interface Dependency {
  source: string;
  target: string;
}
export interface Catalog {
  models: ModelRecord[];
  edges: Dependency[];
  revision: string;
}
export interface Positioned {
  id: string;
  x: number;
  y: number;
}
export interface LayoutResult {
  nodes: Positioned[];
  width: number;
  height: number;
}
export interface WorkspaceState {
  chooser: boolean;
  chooserQuery: string;
  chooserPage: number;
  selected: string[];
  selectedOnly: boolean;
  visible: string[];
  expanded: string[];
  collapsed: string[];
  undo: { query: string } | null;
  layout: LayoutResult | null;
  layoutKey: string;
  viewport: { key: string; x: number; y: number; zoom: number } | null;
  layoutAttempt: number;
  layoutError: string | null;
  layoutStatus: "idle" | "working" | "ready" | "error";
  sampleLoaded: string | null;
  quickModel: string | null;
  listSearch: string;
}
export const initialWorkspace: WorkspaceState = {
  chooser: false,
  chooserQuery: "",
  chooserPage: 1,
  selected: [],
  selectedOnly: false,
  visible: [],
  expanded: [],
  collapsed: [],
  undo: null,
  layout: null,
  layoutKey: "",
  viewport: null,
  layoutAttempt: 0,
  layoutError: null,
  layoutStatus: "idle",
  sampleLoaded: null,
  quickModel: null,
  listSearch: "",
};
