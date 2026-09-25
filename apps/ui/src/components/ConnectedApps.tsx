/**
 * Connected apps, on the account page: the model-context clients -- a claude.ai connector,
 * Claude Desktop, Claude Code -- this person let in by signing in and consenting rather than by
 * pasting a token (ADR 0061).
 *
 * Each row is one consent: the name the client gave itself, the host it sends people back to
 * (which is what identifies it), the grant the person chose, and when. Revoke withdraws the
 * consent and the app's refresh tokens; the control plane reads the consent on every call to
 * `/mcp`, so the app is refused from its very next one. To let it back in, the person signs in
 * through it again and consents afresh.
 *
 * Modelled on `PersonalTokens`, with nothing to mint: an app is let in from the app's side.
 * No `useState`, per `state.md` -- the list is the query cache's and the pending revoke is the
 * mutation's.
 */

import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import type { ConnectedApp } from "@/api/types.ts";
import { Errata } from "@/components/Errata.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import { orMissing } from "@/lib/money.ts";
import { formatDate } from "@/lib/when.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

function grantWord(t: TFunction, grant: ConnectedApp["grant"]): string {
  if (grant === "write") {
    return t("tokens.grantWrite");
  }
  return grant === "read" ? t("tokens.grantRead") : t("apps.grantNone");
}

export function ConnectedApps(): React.JSX.Element {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const locale = useUiStore((state) => state.locale);

  const apps = trpc.account.apps.list.useQuery();
  const revoke = trpc.account.apps.revoke.useMutation({
    onSuccess: async () => {
      await utils.account.apps.list.invalidate();
    },
  });

  if (apps.isPending) {
    return <Skeleton rows={2} />;
  }
  if (apps.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("apps.notLoaded")}
      </Errata>
    );
  }

  const revoking = revoke.isPending ? revoke.variables.id : null;

  return (
    <div className="stack">
      <p className="prose">{t("apps.lead")}</p>

      {apps.data.length === 0 ? (
        <p className="note">{t("apps.none")}</p>
      ) : (
        <Table>
          <TableCaption>{t("apps.caption", { count: apps.data.length })}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t("apps.colName")}</TableHead>
              <TableHead scope="col">{t("apps.colHost")}</TableHead>
              <TableHead scope="col">{t("tokens.colGrant")}</TableHead>
              <TableHead scope="col">{t("apps.colGranted")}</TableHead>
              <TableHead scope="col">{t("tokens.colRevoke")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {apps.data.map((app) => (
              <TableRow key={app.id}>
                <TableCell className="datum">{app.name ?? t("apps.unnamed")}</TableCell>
                <TableCell className="datum datum--quiet">{orMissing(app.redirectHost)}</TableCell>
                <TableCell className="datum datum--quiet">{grantWord(t, app.grant)}</TableCell>
                <TableCell className="datum datum--quiet">
                  {formatDate(app.grantedAt, locale)}
                </TableCell>
                <TableCell>
                  <button
                    className="plate plate--small"
                    type="button"
                    disabled={revoking !== null}
                    onClick={(): void => {
                      revoke.mutate({ id: app.id });
                    }}
                  >
                    {revoking === app.id ? t("tokens.revoking") : t("tokens.revoke")}
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {revoke.isError ? (
        <Errata heading={t("tokens.notRevoked")} live={true} error={revoke.error} />
      ) : null}
    </div>
  );
}
