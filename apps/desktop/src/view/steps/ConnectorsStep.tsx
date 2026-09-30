/**
 * The connectors step, which a person may skip: the OAuth clients they registered themselves.
 *
 * No client ships in this app (ADR 0095). A person registers their own Google app for Gmail and
 * Drive, and their own Xero app, and pastes the pair here -- so each card shows the one thing
 * the provider will ask them for, the redirect URI to register, derived from where the install
 * opens, and links to this release's guide for doing it. HubSpot needs nothing here: a private
 * app's token is pasted per customer, inside Undercroft.
 */

import { installUrl, redirectUris } from "@undercroft/setup/answers";
import { type ReactNode, useId } from "react";
import type { Link } from "../../rpc.ts";
import { useCommands, useT, useWizard } from "../context.ts";
import { StepFrame, StepNav, TextField } from "../fields.tsx";
import { answersOf, type Connector } from "../wizard.ts";

const GUIDE: Readonly<Record<Connector, Link>> = {
  googleIngest: "googleIngestGuide",
  xero: "xeroGuide",
};

function ConnectorCard({ connector }: { readonly connector: Connector }): ReactNode {
  const t = useT();
  const commands = useCommands();
  const wizard = useWizard((state) => state);
  const client = wizard.draft[connector];
  const name = t(`connectors.${connector}`);
  const uri = redirectUris(installUrl(answersOf(wizard)))[connector];
  const checkboxId = useId();
  return (
    <section className={client.enabled ? "card card--on" : "card"}>
      <div className="card__head">
        <input
          checked={client.enabled}
          id={checkboxId}
          onChange={(event): void =>
            wizard.editConnector(connector, { enabled: event.currentTarget.checked })
          }
          type="checkbox"
        />
        <label className="card__title" htmlFor={checkboxId}>
          {t("connectors.enable", { name })}
        </label>
      </div>
      <p className="note">{t("connectors.redirect")}</p>
      <p className="mono uri">{uri}</p>
      <button
        className="link"
        onClick={(): void => void commands.openLink(GUIDE[connector])}
        type="button"
      >
        {t("connectors.guide")}
      </button>
      {client.enabled ? (
        <div className="stack">
          <TextField
            label={t("connectors.clientId")}
            mono={true}
            onChange={(value): void => wizard.editConnector(connector, { clientId: value })}
            value={client.clientId}
          />
          <TextField
            field={connector}
            label={t("connectors.clientSecret")}
            mono={true}
            onChange={(value): void => wizard.editConnector(connector, { clientSecret: value })}
            secret={true}
            value={client.clientSecret}
          />
        </div>
      ) : null}
    </section>
  );
}

export function ConnectorsStep(): ReactNode {
  const t = useT();
  const skip = useWizard((wizard) => wizard.skipConnectors);
  return (
    <StepFrame
      actions={
        <StepNav
          extra={
            <button className="button button--quiet" onClick={skip} type="button">
              {t("connectors.skip")}
            </button>
          }
        />
      }
      lead={t("connectors.lead")}
      title={t("connectors.title")}
    >
      <ConnectorCard connector="googleIngest" />
      <ConnectorCard connector="xero" />
    </StepFrame>
  );
}
