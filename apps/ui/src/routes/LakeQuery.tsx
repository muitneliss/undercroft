/**
 * The lake's console, as its own page: the whole window given to one query and its answer.
 *
 * WHY IT LEFT THE LEAF. It was the fourth band on the lake's index, under a summary, a row
 * browser and a search, and a band is as tall as the page has left over. That produced an
 * editor eight lines deep above a grid twelve rows deep -- the one division of a screen that
 * serves neither the writing nor the reading -- with three bands the reader was not using
 * scrolled off above it. An operator who came to answer a question about a hundred thousand
 * rows was given a porthole.
 *
 * So the console takes the leaf and the leaf takes the window (`fill`), and the index keeps a
 * door to it. What this route owns is only that: the frame, and who may open it.
 *
 * WHO MAY OPEN IT is an admin, because the console answers with rows -- which for a CRM are
 * names and for a mailbox are whatever the mail said. The server refuses everyone else
 * regardless; refusing here as well is the honest rendering of what the reader may do, and it
 * means a member who follows a pasted address is told so rather than shown an editor that
 * answers every press with a refusal.
 */

import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { Errata } from "@/components/Errata.tsx";
import { LakeConsole } from "@/components/LakeConsole.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { parseStream } from "@/lib/lake.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

export function LakeQuery({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const [params] = useSearchParams();
  const tenant = trpc.tenants.get.useQuery({ tenantId });

  if (tenant.isPending) {
    return <Skeleton rows={6} />;
  }
  if (tenant.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("lake.notLoaded", { tenantId })}
      </Errata>
    );
  }
  if (tenant.data.role !== "admin") {
    return (
      <Errata heading={t("lake.consoleRefused")} live={true}>
        {t("lake.consoleAdminOnly")}
      </Errata>
    );
  }

  return <LakeConsole tenantId={tenantId} locale={locale} stream={parseStream(params)} />;
}
