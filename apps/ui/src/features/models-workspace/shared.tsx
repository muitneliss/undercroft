import "./details.css";
import { useWords } from "./hooks.ts";
import type { ModelRecord } from "./types.ts";
import "./workspace.css";
export function GroupLabel({ id }: { id: string }): React.JSX.Element {
  const { t } = useWords();
  const labels: Record<string, string> = {
    raw: t("modelsWorkspace.raw"),
    input: t("modelsWorkspace.input"),
    transform: t("modelsWorkspace.transform"),
    output: t("modelsWorkspace.output"),
    unclassified: t("modelsWorkspace.unclassified"),
    receivables: t("modelsWorkspace.receivables"),
    sales: t("modelsWorkspace.sales"),
    customers: t("modelsWorkspace.customers"),
    inventory: t("modelsWorkspace.inventory"),
    unknown: t("modelsWorkspace.unknown"),
    none: t("modelsWorkspace.none"),
    multiple: t("modelsWorkspace.multiple"),
    xero: "Xero",
    hubspot: "HubSpot",
    shopify: "Shopify",
    stripe: "Stripe",
  };
  return <>{labels[id] ?? id}</>;
}
export function ModelName({ model }: { model: ModelRecord }): React.JSX.Element {
  const { locale } = useWords();
  return (
    <>
      <strong>{model.title[locale]}</strong>
      <code>{model.id}</code>
    </>
  );
}
export function Pager({
  page,
  total,
  size = 25,
  change,
}: {
  page: number;
  total: number;
  size?: number;
  change: (page: number) => void;
}): React.JSX.Element {
  const { t } = useWords();
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="mw-pager">
      <button
        className="plate plate--small"
        type="button"
        disabled={page <= 1}
        onClick={(): void => change(page - 1)}
      >
        {t("modelsWorkspace.previous")}
      </button>
      <label>
        <span className="mw-sr">{t("modelsWorkspace.page", { page, pages })}</span>
        <select
          className="input input--select"
          aria-label={t("modelsWorkspace.page", { page, pages })}
          value={page}
          onChange={(event): void => change(Number.parseInt(event.target.value, 10))}
        >
          {Array.from({ length: pages }, (_, index) => index + 1).map((pageNumber) => (
            <option key={pageNumber} value={pageNumber}>
              {t("modelsWorkspace.page", { page: pageNumber, pages })}
            </option>
          ))}
        </select>
      </label>
      <button
        className="plate plate--small"
        type="button"
        disabled={page >= pages}
        onClick={(): void => change(page + 1)}
      >
        {t("modelsWorkspace.next")}
      </button>
    </div>
  );
}
