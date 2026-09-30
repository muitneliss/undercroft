/**
 * The settings step: where the install goes and how people reach it.
 *
 * A desktop install asks for a folder and a port; the address it opens at follows from the port
 * (`installUrl`), and is shown as it is typed. A server install also asks for its https address,
 * its first administrator and how people sign in -- the two ways that prove an address.
 *
 * Re-opened over an existing install, the folder is shown and fixed: an install is its folder's
 * `.env`, and moving it is an uninstall and an install, not a setting.
 */

import { installUrl, redirectUris } from "@undercroft/setup/answers";
import type { ReactNode } from "react";
import { useCommands, useT, useWizard } from "../context.ts";
import { Plates, StepFrame, StepNav, TextField } from "../fields.tsx";
import { answersOf, type Draft } from "../wizard.ts";

function FolderField(): ReactNode {
  const t = useT();
  const commands = useCommands();
  const dir = useWizard((wizard) => wizard.draft.dir);
  const locked = useWizard((wizard) => wizard.reconfigure);
  const edit = useWizard((wizard) => wizard.edit);
  return (
    <div className="row row--field">
      <TextField
        field="dir"
        hint={locked ? t("settings.dirLocked") : t("settings.dirHint")}
        label={t("settings.dir")}
        mono={true}
        onChange={(value): void => edit({ dir: value })}
        readOnly={locked}
        value={dir}
      />
      {locked ? null : (
        <button className="button" onClick={(): void => void commands.chooseFolder()} type="button">
          {t("settings.choose")}
        </button>
      )}
    </div>
  );
}

function SignInFields(): ReactNode {
  const t = useT();
  const wizard = useWizard((state) => state);
  const { draft, edit } = wizard;
  const plates: readonly { readonly value: Draft["signInKind"]; readonly label: string }[] = [
    { value: "email", label: t("settings.signInEmail") },
    { value: "google", label: t("settings.signInGoogle") },
  ];
  return (
    <>
      <Plates
        chosen={draft.signInKind}
        legend={t("settings.signIn")}
        name="sign-in"
        onChoose={(signInKind): void => edit({ signInKind })}
        plates={plates}
      />
      {draft.signInKind === "email" ? (
        <>
          <TextField
            label={t("settings.emailApiKey")}
            mono={true}
            onChange={(value): void => edit({ emailApiKey: value })}
            secret={true}
            value={draft.emailApiKey}
          />
          <TextField
            field="signIn"
            label={t("settings.emailFrom")}
            onChange={(value): void => edit({ emailFrom: value })}
            value={draft.emailFrom}
          />
        </>
      ) : (
        <>
          <TextField
            hint={t("settings.googleRedirect", {
              uri: redirectUris(installUrl(answersOf(wizard))).googleSignIn,
            })}
            label={t("settings.googleClientId")}
            mono={true}
            onChange={(value): void => edit({ googleClientId: value })}
            value={draft.googleClientId}
          />
          <TextField
            field="signIn"
            label={t("settings.googleClientSecret")}
            mono={true}
            onChange={(value): void => edit({ googleClientSecret: value })}
            secret={true}
            value={draft.googleClientSecret}
          />
        </>
      )}
    </>
  );
}

export function SettingsStep(): ReactNode {
  const t = useT();
  const wizard = useWizard((state) => state);
  const { draft, mode, reconfigure, edit } = wizard;
  const url = installUrl(answersOf(wizard));
  return (
    <StepFrame
      actions={<StepNav />}
      lead={reconfigure ? t("settings.reconfigure") : undefined}
      title={t("settings.title")}
    >
      <FolderField />
      <TextField
        field="port"
        hint={mode === "desktop" ? t("settings.portHint", { url }) : undefined}
        label={t("settings.port")}
        mono={true}
        onChange={(value): void => edit({ port: value })}
        value={draft.port}
      />
      {mode === "server" ? (
        <>
          <TextField
            field="publicUrl"
            label={t("settings.publicUrl")}
            mono={true}
            onChange={(value): void => edit({ publicUrl: value })}
            placeholder="https://"
            value={draft.publicUrl}
          />
          <TextField
            field="adminEmail"
            label={t("settings.adminEmail")}
            onChange={(value): void => edit({ adminEmail: value })}
            value={draft.adminEmail}
          />
          <SignInFields />
          <TextField
            field="bind"
            hint={t("settings.bindHint")}
            label={t("settings.bind")}
            mono={true}
            onChange={(value): void => edit({ bind: value })}
            value={draft.bind}
          />
        </>
      ) : null}
    </StepFrame>
  );
}
