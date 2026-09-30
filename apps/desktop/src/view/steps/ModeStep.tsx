/**
 * Who the install is for, which decides everything the settings step asks: a desktop install
 * needs a folder and a port, a server install an https address, an administrator and a way for
 * people to sign in.
 */

import type { Mode } from "@undercroft/setup/answers";
import type { ReactNode } from "react";
import { useT, useWizard } from "../context.ts";
import { type Plate, Plates, StepFrame, StepNav } from "../fields.tsx";

export function ModeStep(): ReactNode {
  const t = useT();
  const mode = useWizard((wizard) => wizard.mode);
  const chooseMode = useWizard((wizard) => wizard.chooseMode);
  const plates: readonly Plate<Mode>[] = [
    { value: "desktop", label: t("mode.desktop"), hint: t("mode.desktopHint") },
    { value: "server", label: t("mode.server"), hint: t("mode.serverHint") },
  ];
  return (
    <StepFrame actions={<StepNav />} title={t("mode.title")}>
      <Plates
        chosen={mode}
        legend={t("steps.mode")}
        name="mode"
        onChoose={chooseMode}
        plates={plates}
      />
    </StepFrame>
  );
}
