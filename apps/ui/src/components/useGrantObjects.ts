/**
 * What the grant form may offer to read (ADR 0142): a model or reference table, a raw stream or
 * a whole source, a question or a dashboard, or the whole of one of them.
 *
 * Every object offered is one the server ANSWERED for this reader: the models, reference tables,
 * streams and reports its lists return, which are already narrowed to what the reader reaches,
 * and a wildcard only when `grants.reach` says the reader reaches the whole of it. The browser
 * computes no reach of its own; offering only what a person holds is a courtesy, and the subset
 * rule on the server is the control. `GrantObjects.tsx` draws what this gathers.
 */

import {
  DOCUMENTS_ENTITY,
  modelObject,
  type Reach,
  rawObject,
  reportObject,
  wholeObject,
} from "@undercroft/contracts/access";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { wholeList } from "@/lib/listAnswers.ts";
import { trpc } from "@/trpc.ts";

/** One object the form may offer: its object as a grant spells it, and how a reader names it. */
export interface ObjectOption {
  readonly object: string;
  readonly label: string;
}

/** The objects the form may offer, by kind, and the name each report's object reads as. */
export interface GrantObjects {
  readonly whole: readonly ObjectOption[];
  readonly models: readonly ObjectOption[];
  readonly streams: readonly ObjectOption[];
  readonly reports: readonly ObjectOption[];
  /** A report's name by its object, for the table to name a grant on it. */
  readonly names: ReadonlyMap<string, string>;
  /** Which names are reference tables, whose columns `seeds.get` answers rather than `models.get`. */
  readonly seeds: ReadonlySet<string>;
}

/** The wildcards the reader holds, as the server says: only those may be given. */
function wholeOptions(reach: Reach | undefined, t: TFunction): ObjectOption[] {
  const held: [boolean, ObjectOption][] = [
    [
      reach?.models === "all",
      { object: wholeObject("model"), label: t("grantObjects.everyModel") },
    ],
    [reach?.raw === "all", { object: wholeObject("raw"), label: t("grantObjects.wholeLake") }],
    [
      reach?.reports === "all",
      { object: wholeObject("report"), label: t("grantObjects.everyReport") },
    ],
  ];
  return held.flatMap(([holds, option]) => (holds ? [option] : []));
}

interface StreamLists {
  readonly records: readonly { readonly source: string; readonly entity: string }[];
  readonly documents: readonly { readonly source: string }[];
}

/** Each source whole, then each of its record streams, then each document catalogue. */
function streamOptions(lake: StreamLists | undefined, t: TFunction): ObjectOption[] {
  const records = lake?.records ?? [];
  const documents = lake?.documents ?? [];
  const sources = [...new Set([...records, ...documents].map((stream) => stream.source))];
  return [
    ...sources.map((source) => ({
      object: rawObject(source, null),
      label: t("grantObjects.wholeSource", { source }),
    })),
    ...records.map((stream) => ({
      object: rawObject(stream.source, stream.entity),
      label: t("grantObjects.stream", { source: stream.source, entity: stream.entity }),
    })),
    ...documents.map((stream) => ({
      object: rawObject(stream.source, DOCUMENTS_ENTITY),
      label: t("grantObjects.documents", { source: stream.source }),
    })),
  ];
}

interface Named {
  readonly id: string;
  readonly name: string;
}

function reportOptions(
  questions: readonly Named[],
  dashboards: readonly Named[],
  t: TFunction,
): ObjectOption[] {
  return [
    ...questions.map((question) => ({
      object: reportObject("question", question.id),
      label: t("grantObjects.questionOption", { name: question.name }),
    })),
    ...dashboards.map((dashboard) => ({
      object: reportObject("dashboard", dashboard.id),
      label: t("grantObjects.dashboardOption", { name: dashboard.name }),
    })),
  ];
}

/** The objects this reader may offer, from the server's own lists. */
export function useGrantObjects(tenantId: string): GrantObjects {
  const { t } = useTranslation();
  const reach = trpc.grants.reach.useQuery({ tenantId });
  const models = trpc.models.list.useQuery({ tenantId }, { select: wholeList });
  const seeds = trpc.seeds.list.useQuery({ tenantId });
  const lake = trpc.lake.summary.useQuery({ tenantId });
  const questions = trpc.bi.questions.list.useQuery({ tenantId }, { select: wholeList });
  const dashboards = trpc.bi.dashboards.list.useQuery({ tenantId });

  const named = [...(models.data ?? []), ...(seeds.data ?? [])].map((item) => item.name);
  const reports = reportOptions(questions.data ?? [], dashboards.data ?? [], t);
  return {
    whole: wholeOptions(reach.data?.reach, t),
    models: [...new Set(named)].sort().map((name) => ({ object: modelObject(name), label: name })),
    streams: streamOptions(lake.data, t),
    reports,
    names: new Map(reports.map((option) => [option.object, option.label])),
    seeds: new Set((seeds.data ?? []).map((seed) => seed.name)),
  };
}
