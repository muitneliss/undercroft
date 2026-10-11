import "./workspace.css";
import "./details.css";
import { useQuery } from "@tanstack/react-query";
import { formatMoney, MISSING } from "@/lib/money.ts";
import { patchWorkspace, useWords, useWorkspace } from "./hooks.ts";
import { ProfileConfiguration } from "./ProfileConfiguration.tsx";
import { DataEvidence, MissingProfile, ProfileEvidence } from "./ProfileEvidence.tsx";
import { ProfileOperations } from "./ProfileOperations.tsx";
import type { ModelDetails, ProfileSource, SampleCell } from "./profileSource.ts";
import type { ModelRecord } from "./types.ts";

export function ProfileDetails({
  model,
  source,
  tab,
}: {
  model: ModelRecord;
  source: ProfileSource;
  tab: string;
}): React.JSX.Element {
  const { t } = useWords();
  const query = useQuery({
    queryKey: ["models-prototype-detail", model.id],
    queryFn: ({ signal }) => source.details(model.id, signal),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  if (query.isPending) {
    return <p>{t("common.loading")}</p>;
  }
  if (query.isError) {
    return (
      <div className="mw-note">
        <p>{t("common.notLoaded")}</p>
        <button
          className="plate"
          type="button"
          onClick={(): void => {
            void query.refetch();
          }}
        >
          {t("modelsWorkspace.retry")}
        </button>
      </div>
    );
  }
  if (tab === "operations") {
    return <ProfileOperations model={model} detail={query.data} />;
  }
  if (!query.data) {
    return <MissingProfile />;
  }
  if (tab === "overview") {
    return query.data.engineering ? (
      <ProfileEvidence evidence={query.data.engineering} />
    ) : (
      <MissingProfile />
    );
  }
  return tab === "data" ? (
    <Data model={model} source={source} detail={query.data} />
  ) : (
    <ProfileConfiguration detail={query.data} />
  );
}
function Data({
  model,
  source,
  detail,
}: {
  model: ModelRecord;
  source: ProfileSource;
  detail: ModelDetails;
}): React.JSX.Element {
  const { t, locale } = useWords();
  const state = useWorkspace();
  return (
    <div className="mw-stack">
      <p className="mw-lead">{t("modelsWorkspace.profileDataHint")}</p>
      <DataEvidence detail={detail} />
      <h3>{t("modelsWorkspace.columns")}</h3>
      <p className="mw-caption">{t("modelsWorkspace.declaredSchema")}</p>
      <div className="mw-table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("modelsWorkspace.column")}</th>
              <th>{t("modelsWorkspace.type")}</th>
              <th>{t("modelsWorkspace.meaning")}</th>
            </tr>
          </thead>
          <tbody>
            {detail.columns.map((column) => (
              <tr key={column.name}>
                <td>
                  <code>{column.name}</code>
                </td>
                <td>{column.type}</td>
                <td>{column.description[locale]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mw-note">{t("modelsWorkspace.profilingUnknown")}</p>
      <p>{t("modelsWorkspace.sampleHint")}</p>
      <button
        type="button"
        className="plate"
        onClick={(): void => patchWorkspace({ sampleLoaded: model.id })}
      >
        {t("modelsWorkspace.loadSample")}
      </button>
      {state.sampleLoaded === model.id && <Sample model={model} source={source} />}
    </div>
  );
}
function Sample({
  model,
  source,
}: {
  model: ModelRecord;
  source: ProfileSource;
}): React.JSX.Element {
  const { t } = useWords();
  const query = useQuery({
    queryKey: ["models-prototype-sample", model.id],
    queryFn: ({ signal }) => source.sample(model.id, signal),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  if (query.isPending) {
    return <p>{t("common.loading")}</p>;
  }
  if (query.isError) {
    return <p role="alert">{t("common.notLoaded")}</p>;
  }
  if (!query.data) {
    return <p>{t("modelsWorkspace.missing")}</p>;
  }
  const sample = query.data;
  return (
    <div className="mw-table-wrap">
      <table>
        <caption>{t("modelsWorkspace.sample")}</caption>
        <thead>
          <tr>
            {sample.columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sample.rows.map((row) => (
            <tr key={JSON.stringify(row)}>
              {row.map((cell, index) => (
                <td key={sample.columns[index]}>{cellText(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function cellText(cell: SampleCell): string {
  return cell.currency
    ? formatMoney(cell.text === null ? null : { amount: cell.text, currency: cell.currency })
    : (cell.text ?? MISSING);
}
