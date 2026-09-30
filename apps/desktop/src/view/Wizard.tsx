/**
 * The wizard's window: the rail of steps down the spine, and the current step's leaf.
 *
 * The rail is the product's section board in miniature (`apps/ui/src/index.css`): steps a person
 * has passed are struck, the current one is the chrome plate, and the ones ahead are ink-3. It is
 * not a menu -- a step is reached by answering the one before it, which is what `canAdvance`
 * guards -- so it is an ordered list, not a set of links.
 */

import type { ReactNode } from "react";
import { useT, useWizard } from "./context.ts";
import { ConnectorsStep } from "./steps/ConnectorsStep.tsx";
import { DockerStep } from "./steps/DockerStep.tsx";
import { DoneStep } from "./steps/DoneStep.tsx";
import { InstallStep } from "./steps/InstallStep.tsx";
import { LanguageStep } from "./steps/LanguageStep.tsx";
import { ModeStep } from "./steps/ModeStep.tsx";
import { SettingsStep } from "./steps/SettingsStep.tsx";
import { STEPS, type Step } from "./wizard.ts";

function CurrentStep({ step }: { readonly step: Step }): ReactNode {
  switch (step) {
    case "language":
      return <LanguageStep />;
    case "mode":
      return <ModeStep />;
    case "docker":
      return <DockerStep />;
    case "settings":
      return <SettingsStep />;
    case "connectors":
      return <ConnectorsStep />;
    case "install":
      return <InstallStep />;
    case "done":
      return <DoneStep />;
    default:
      return step satisfies never;
  }
}

function Rail({ current }: { readonly current: Step }): ReactNode {
  const t = useT();
  const at = STEPS.indexOf(current);
  return (
    <nav aria-label={t("app.windowTitle")} className="rail">
      <p className="rail__name">{t("app.name")}</p>
      <ol className="rail__steps">
        {STEPS.map((step, index) => {
          const place = index < at ? "passed" : index === at ? "current" : "ahead";
          return (
            <li
              aria-current={place === "current" ? "step" : undefined}
              className={`rail__step rail__step--${place}`}
              key={step}
            >
              {t(`steps.${step}`)}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function Wizard(): ReactNode {
  const step = useWizard((wizard) => wizard.step);
  const locale = useWizard((wizard) => wizard.locale);
  return (
    <main className="wizard" lang={locale}>
      <Rail current={step} />
      <CurrentStep step={step} />
    </main>
  );
}
