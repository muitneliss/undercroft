/**
 * The Journal read as a village (ADR 0115, `docs/design/village.md`): the same runs as the
 * ledger, drawn as people at work, with the words beside the picture.
 *
 * The words are the content and the canvas is their picture, as the cover's film is its lists'
 * (ADR 0063): the canvas is `aria-hidden` and draws no letter, and the table beside it names every
 * character, what they are doing for whom, and since when, with a link to the run. Pointing at a
 * figure or a building in the picture lights its row here; pressing one opens its run or its
 * division.
 *
 * It reads only what the Journal reads, with the reader's own session: the newest page of runs,
 * what each running run has said, the newest closed build for its steps, and the connections for
 * the roads. The runs are re-read every 5 seconds while one is running and every 15 otherwise, so
 * a scheduled run that starts is noticed without anybody pressing anything; a running run's feed
 * at the ledger's own one second.
 *
 * Loaded on its own (`Journal.tsx` lazy-loads it), so `three` and the models are fetched only by
 * a reader who opens the village. Nothing here is `useState`: the film holds its own values, and
 * what it tells the page it writes as `data-` attributes (`lib/village/runtime.ts`).
 */

import type { TFunction } from "i18next";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import type { Connection, RunDetail, RunView } from "@/api/types.ts";
import { Errata } from "@/components/Errata.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { customerPagePath, division, divisionPath } from "@/lib/divisions.ts";
import { MISSING } from "@/lib/money.ts";
import { describeRun, journalPath, sourceLabel } from "@/lib/runs.ts";
import { PLACES } from "@/lib/village/layout.ts";
import { VillageFilm } from "@/lib/village/runtime.ts";
import { type Actor, deriveVillage, type VillageScene } from "@/lib/village/script.ts";
import { formatDateTime } from "@/lib/when.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

const PAGE = 50;
const RUNNING_POLL_MS = 5000;
const IDLE_POLL_MS = 15_000;
/** A running run's feed, at the ledger's own rate (`RunDetail`). */
const LIVE_POLL_MS = 1000;

/** Where pressing a building goes: the division it stands for. */
function placePath(tenantId: string, id: string): string {
  const place = PLACES.find((p) => p.id === id);
  if (place === undefined) {
    return divisionPath("journal", tenantId);
  }
  return place.division === "customers"
    ? customerPagePath(tenantId)
    : divisionPath(place.division, tenantId);
}

export function Village({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const runs = trpc.runs.list.useQuery(
    { tenantId, limit: PAGE },
    {
      refetchInterval: (query) =>
        query.state.data?.items.some((run) => run.status === "running") === true
          ? RUNNING_POLL_MS
          : IDLE_POLL_MS,
    },
  );
  const connections = trpc.connections.list.useQuery({ tenantId });
  const items = runs.data?.items ?? [];
  const running = items.filter((run) => run.status === "running");
  const feeds = trpc.useQueries((query) =>
    running.map((run) =>
      query.runs.events({ tenantId, runId: run.id }, { refetchInterval: LIVE_POLL_MS }),
    ),
  );
  const lastBuildId =
    items.find(
      (run) => (run.kind === "transform" || run.kind === "build") && run.status !== "running",
    )?.id ?? null;
  const lastBuild = trpc.runs.get.useQuery(
    { tenantId, runId: lastBuildId ?? "" },
    { enabled: lastBuildId !== null },
  );

  if (runs.isPending) {
    return <Skeleton rows={6} />;
  }
  if (runs.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("journal.village.notLoaded", { tenantId })}
      </Errata>
    );
  }

  const scene = deriveVillage({
    now: new Date(),
    runs: items,
    events: new Map(running.map((run, at) => [run.id, feeds[at]?.data ?? []])),
    lastBuild: lastBuildId === null ? null : (lastBuild.data ?? null),
    connections: connections.data ?? [],
  });
  const known = lastBuild.data === undefined ? items : [...items, lastBuild.data];

  return (
    <VillageBoard
      tenantId={tenantId}
      scene={scene}
      runs={known}
      accounts={connections.data ?? []}
    />
  );
}

/**
 * The picture and the words, in one element: the film lights the words it is pointed at, so it
 * is given the element they are in.
 */
function VillageBoard({
  tenantId,
  scene,
  runs,
  accounts,
}: {
  tenantId: string;
  scene: VillageScene;
  runs: readonly (RunView | RunDetail)[];
  accounts: readonly Connection[];
}): React.JSX.Element {
  const { t } = useTranslation();
  const boardRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const filmRef = useRef<VillageFilm | null>(null);
  // The newest scene, for the film to start with and for a press to look a figure up in. A ref
  // and not state: nothing renders from it, and the film reads it outside React.
  const latestRef = useRef(scene);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    const elements =
      boardRef.current !== null && frameRef.current !== null && canvasRef.current !== null
        ? { words: boardRef.current, frame: frameRef.current, canvas: canvasRef.current }
        : null;
    if (elements === null) {
      return;
    }
    void VillageFilm.start(elements, {
      onFigure: (key) => {
        const runId = latestRef.current.actors.find((actor) => actor.key === key)?.runId ?? null;
        if (runId !== null) {
          void navigate(journalPath(tenantId, { runId }));
        }
      },
      onPlace: (id) => {
        void navigate(placePath(tenantId, id));
      },
    }).then((started) => {
      if (!alive) {
        started?.dispose();
        return;
      }
      filmRef.current = started;
      started?.show(latestRef.current);
    });
    return (): void => {
      alive = false;
      filmRef.current?.dispose();
      filmRef.current = null;
    };
  }, [navigate, tenantId]);

  useEffect(() => {
    latestRef.current = scene;
    filmRef.current?.show(scene);
  }, [scene]);

  return (
    <div className="stack" ref={boardRef}>
      <div className="village" ref={frameRef}>
        <div className="village__picture" aria-hidden="true">
          <canvas ref={canvasRef} />
        </div>
        <p className="prose village__failed">{t("journal.village.failed")}</p>
      </div>
      <WorkList tenantId={tenantId} actors={scene.actors} runs={runs} accounts={accounts} />
      <PlaceList tenantId={tenantId} />
    </div>
  );
}

function doingOf(t: TFunction, actor: Actor): string {
  return actor.doing === "inspecting" && actor.slip
    ? t("journal.village.doing.inspectingFailed")
    : t(`journal.village.doing.${actor.doing}`);
}

/** Whom a character works for: a courier's account, or the run a worker is on. */
function forOf(
  t: TFunction,
  actor: Actor,
  run: RunView | RunDetail | undefined,
  accounts: readonly Connection[],
): string {
  if (actor.source !== null) {
    return sourceLabel(actor.source, accounts);
  }
  return run === undefined ? MISSING : describeRun(t, run, accounts);
}

/** Every character, what they are doing for whom, and since when; the run one press away. */
function WorkList({
  tenantId,
  actors,
  runs,
  accounts,
}: {
  tenantId: string;
  actors: readonly Actor[];
  runs: readonly (RunView | RunDetail)[];
  accounts: readonly Connection[];
}): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);

  return (
    <div className="table-scroll">
      <table className="table">
        <caption>{t("journal.village.workCaption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("journal.village.colWho")}</th>
            <th scope="col">{t("journal.village.colFor")}</th>
            <th scope="col">{t("journal.village.colDoing")}</th>
            <th scope="col">{t("journal.village.colSince")}</th>
          </tr>
        </thead>
        <tbody>
          {actors.map((actor) => {
            const run = runs.find((candidate) => candidate.id === actor.runId);
            return (
              <tr key={actor.key} data-actor={actor.key}>
                <td>{t(`journal.village.role.${actor.role}`)}</td>
                <td>{forOf(t, actor, run, accounts)}</td>
                <td>
                  {actor.runId === null ? (
                    doingOf(t, actor)
                  ) : (
                    <Link to={journalPath(tenantId, { runId: actor.runId })}>
                      {doingOf(t, actor)}
                    </Link>
                  )}
                </td>
                <td className="datum">
                  {run === undefined ? MISSING : formatDateTime(run.startedAt, locale)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The buildings, each a door to the division it stands for. */
function PlaceList({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="table-scroll">
      <table className="table">
        <caption>{t("journal.village.placesCaption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("journal.village.colBuilding")}</th>
            <th scope="col">{t("journal.village.colOpens")}</th>
          </tr>
        </thead>
        <tbody>
          {PLACES.map((place) => (
            <tr key={place.id} data-place={place.id}>
              <td>
                <Link to={placePath(tenantId, place.id)}>
                  {t(`journal.village.place.${place.id}`)}
                </Link>
              </td>
              <td>{t(division(place.division).labelKey)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
