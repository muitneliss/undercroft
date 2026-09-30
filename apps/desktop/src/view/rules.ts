/**
 * What moves a person through the wizard, and what stops them.
 *
 *   language -> mode -> docker -> settings -> connectors -> install -> done
 *
 * `validateAnswers` from `@undercroft/setup` is the judge of whether an install can run; this
 * module only decides which step a problem belongs to, so a person is stopped at the step that
 * can fix it.
 *
 * - **docker** lets nobody past until Docker's state is `ready`. An install written for a
 *   daemon that does not answer fails at the pull, minutes later and further from the cause.
 * - **connectors** is optional: skipping turns both off and moves on. A connector that is ON
 *   must be whole, because a half-entered client is a typo, not a choice.
 * - **re-opened** over an existing install (the tray's Settings), the wizard starts at settings
 *   and never goes back further: that install's language, mode and Docker were settled when it
 *   was made. It never offers to regenerate a secret -- `@undercroft/setup` keeps every one an
 *   install holds -- and `plan` says so, rather than implying a fresh start.
 */

import { installUrl, type Mode, validateAnswers } from "@undercroft/setup/answers";
import type { InstallEvent } from "../rpc.ts";
import {
  answersOf,
  type ImageProgress,
  type InstallFailure,
  type InstallView,
  STEPS,
  type Step,
  type WizardField,
  type WizardProblem,
  type WizardState,
} from "./wizard.ts";

/** Which fields each step asks for. */
const FIELDS_OF: Readonly<Partial<Record<Step, readonly WizardField[]>>> = {
  settings: ["dir", "port", "imageTag", "bind", "publicUrl", "adminEmail", "signIn"],
  connectors: ["googleIngest", "xero"],
};

/** What stops a person leaving `state.step`, as codes the view words. */
export function problemsOf(state: WizardState): WizardProblem[] {
  const fields = FIELDS_OF[state.step];
  if (fields === undefined) {
    return [];
  }
  const dir: WizardProblem[] =
    state.draft.dir.trim() === "" ? [{ field: "dir", code: "dir-required" }] : [];
  return [...dir, ...validateAnswers(answersOf(state))].filter((problem) =>
    fields.includes(problem.field),
  );
}

/** Whether a person may leave `state.step` forwards. */
export function canAdvance(state: WizardState): boolean {
  switch (state.step) {
    case "language":
    case "mode":
      return true;
    case "docker":
      return state.docker.state?.state === "ready" && state.docker.busy === null;
    case "settings":
    case "connectors":
      return problemsOf(state).length === 0;
    // `install` is left by finishing an install, never by pressing Continue.
    case "install":
    case "done":
      return false;
    default:
      return state.step satisfies never;
  }
}

export function stepAfter(step: Step): Step {
  return STEPS[Math.min(STEPS.indexOf(step) + 1, STEPS.length - 1)] ?? step;
}

/** The step before; a re-configuration's first step is settings. */
export function stepBefore(state: WizardState): Step {
  const floor = state.reconfigure ? STEPS.indexOf("settings") : 0;
  return STEPS[Math.max(STEPS.indexOf(state.step) - 1, floor)] ?? state.step;
}

/** The step an install that did not finish sends a person back to. */
export function stepForFailure(failure: InstallFailure): "docker" | "settings" | "install" {
  switch (failure.reason) {
    case "docker":
      return "docker";
    case "invalid":
      return "settings";
    default:
      return "install";
  }
}

/** What the install step says it will do, before a person presses Install. */
export interface Plan {
  readonly mode: Mode;
  readonly dir: string;
  readonly url: string;
  readonly tag: string;
  /** New secrets for a new install; an existing install keeps every one it holds. */
  readonly secrets: "generate" | "keep";
}

export function plan(state: WizardState): Plan {
  return {
    mode: state.mode,
    dir: state.draft.dir.trim(),
    url: installUrl(answersOf(state)),
    tag: state.release,
    secrets: state.reconfigure ? "keep" : "generate",
  };
}

function imagesAfter(images: readonly ImageProgress[], next: ImageProgress): ImageProgress[] {
  return images.some((image) => image.image === next.image)
    ? images.map((image) => (image.image === next.image ? next : image))
    : [...images, next];
}

/** An install's view after one more event from the main process. */
export function installAfter(install: InstallView, event: InstallEvent): InstallView {
  switch (event.kind) {
    case "phase":
      return { ...install, phase: event.phase };
    case "image":
      return {
        ...install,
        images: imagesAfter(install.images, { image: event.image, state: event.state }),
      };
    case "line":
      return { ...install, lastLine: event.line };
    default:
      return event satisfies never;
  }
}
