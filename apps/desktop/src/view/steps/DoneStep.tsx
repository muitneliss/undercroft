/**
 * Where Undercroft is. Open goes to exactly the install's public URL (ADR 0094), so a desktop
 * owner arrives signed in; the `.env` to back up is named, because it is the one file whose loss
 * locks the data.
 */

import type { ReactNode } from "react";
import { useCommands, useT, useWizard } from "../context.ts";
import { StepFrame } from "../fields.tsx";
import { plan } from "../rules.ts";

export function DoneStep(): ReactNode {
  const t = useT();
  const commands = useCommands();
  const wizard = useWizard((state) => state);
  const planned = plan(wizard);
  const url = wizard.url ?? planned.url;
  const separator = wizard.platform === "win32" ? "\\" : "/";
  const env = `${planned.dir}${separator}.env`;
  const email = wizard.draft.adminEmail.trim();
  return (
    <StepFrame
      actions={
        <>
          <button
            className="button button--quiet"
            onClick={(): void => void commands.close()}
            type="button"
          >
            {t("done.close")}
          </button>
          <button
            className="button button--go"
            onClick={(): void => void commands.openInstall()}
            type="button"
          >
            {t("done.open")}
          </button>
        </>
      }
      title={t("done.title")}
    >
      <p className="status status--ok">
        {wizard.mode === "desktop"
          ? t("done.desktop", { url })
          : t("done.server", { port: wizard.draft.port.trim(), email, url })}
      </p>
      {/* The CLI signs in on this machine too, at this exact origin (ADR 0096). */}
      {wizard.mode === "desktop" ? (
        <p className="note note--mono">{t("done.cli", { url })}</p>
      ) : null}
      <p className="note">{t("done.tray")}</p>
      <p className="note">{t("done.backup", { env })}</p>
    </StepFrame>
  );
}
