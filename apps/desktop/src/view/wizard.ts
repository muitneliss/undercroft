/**
 * What the setup wizard holds, and the install answers it describes.
 *
 * The wizard asks the same questions as the terminal wizard (`apps/installer-cli`) and answers
 * them with the same model: a person types into a `Draft` -- strings, as typed, for both modes
 * so switching mode loses nothing -- and `answersOf` reads it as `@undercroft/setup`'s `Answers`,
 * the one shape every front end writes an install from. `draftFrom` is the way back, so a
 * re-opened wizard shows an existing install's answers as they were written.
 */

import type { Locale } from "@undercroft/core/locale";
import type { DockerState, Platform } from "@undercroft/setup";
import {
  type Answers,
  type Connectors,
  DEFAULT_BIND,
  DEFAULT_PORT,
  type Field,
  type Mode,
  type OAuthClient,
  type ProblemCode,
  type SignIn,
} from "@undercroft/setup/answers";
import type { Boot, DockerOffer, ImageState, InstallOutcome, InstallPhase } from "../rpc.ts";

export const STEPS = [
  "language",
  "mode",
  "docker",
  "settings",
  "connectors",
  "install",
  "done",
] as const;

export type Step = (typeof STEPS)[number];

/** `@undercroft/setup`'s fields, and the one question it does not ask: the folder. */
export type WizardField = Field | "dir";
export type WizardProblemCode = ProblemCode | "dir-required";

export interface WizardProblem {
  readonly field: WizardField;
  readonly code: WizardProblemCode;
}

export interface ClientDraft {
  readonly enabled: boolean;
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface Draft {
  readonly dir: string;
  readonly port: string;
  readonly publicUrl: string;
  readonly adminEmail: string;
  readonly bind: string;
  readonly signInKind: SignIn["kind"];
  readonly emailApiKey: string;
  readonly emailFrom: string;
  readonly googleClientId: string;
  readonly googleClientSecret: string;
  readonly googleIngest: ClientDraft;
  readonly xero: ClientDraft;
}

export type Connector = "googleIngest" | "xero";

export interface DockerView {
  /** `null` until the first check answers. */
  readonly state: DockerState | null;
  readonly offer: DockerOffer | null;
  /** What the app is doing about Docker right now. */
  readonly busy: "checking" | "installing" | "starting" | null;
  readonly restartNeeded: boolean;
  /** Windows would not restart when asked; a person restarts it themselves. */
  readonly restartFailed: boolean;
  /** The last install attempt ended without Docker, and a person must do it by hand. */
  readonly installFailed: boolean;
}

export interface ImageProgress {
  readonly image: string;
  readonly state: ImageState;
}

export type InstallFailure = Exclude<InstallOutcome, { readonly ok: true }>;

export interface InstallView {
  readonly running: boolean;
  readonly phase: InstallPhase | null;
  readonly images: readonly ImageProgress[];
  readonly lastLine: string;
  /** How the last attempt ended, when it did not end at `done`. */
  readonly failure: InstallFailure | null;
}

export interface WizardState {
  readonly step: Step;
  readonly locale: Locale;
  readonly mode: Mode;
  readonly release: string;
  readonly platform: Platform;
  /** Re-configuring an install that exists: its folder is fixed and its secrets are kept. */
  readonly reconfigure: boolean;
  readonly draft: Draft;
  /** Set when a person first tries to leave a step, so a fresh form is not all complaints. */
  readonly showProblems: boolean;
  readonly docker: DockerView;
  readonly install: InstallView;
  /** Where the install answers, once it does. */
  readonly url: string | null;
}

export const NO_CLIENT: ClientDraft = { enabled: false, clientId: "", clientSecret: "" };

export const IDLE_INSTALL: InstallView = {
  running: false,
  phase: null,
  images: [],
  lastLine: "",
  failure: null,
};

const PORT = /^\d{1,5}$/u;

function clientDraft(client: OAuthClient | null): ClientDraft {
  return client === null ? NO_CLIENT : { enabled: true, ...client };
}

function clientOf(draft: ClientDraft): OAuthClient | null {
  return draft.enabled
    ? { clientId: draft.clientId.trim(), clientSecret: draft.clientSecret.trim() }
    : null;
}

/** The draft an install's answers read back as, or a new install's defaults. */
function draftFrom(dir: string, existing: Answers | null): Draft {
  const server = existing?.mode === "server" ? existing : null;
  const email = server?.signIn.kind === "email" ? server.signIn : null;
  const google = server?.signIn.kind === "google" ? server.signIn : null;
  return {
    dir,
    port: String(existing?.port ?? DEFAULT_PORT),
    publicUrl: server?.publicUrl ?? "",
    adminEmail: server?.adminEmail ?? "",
    bind: server?.bind ?? DEFAULT_BIND,
    signInKind: server?.signIn.kind ?? "email",
    emailApiKey: email?.apiKey ?? "",
    emailFrom: email?.from ?? "",
    googleClientId: google?.clientId ?? "",
    googleClientSecret: google?.clientSecret ?? "",
    googleIngest: clientDraft(existing?.connectors.googleIngest ?? null),
    xero: clientDraft(existing?.connectors.xero ?? null),
  };
}

/** A port as typed; anything but digits is `NaN`, which `validateAnswers` reports. */
function portOf(raw: string): number {
  const typed = raw.trim();
  return PORT.test(typed) ? Number.parseInt(typed, 10) : Number.NaN;
}

/** The answers the draft describes, for the mode chosen, at this app's release. */
export function answersOf(state: WizardState): Answers {
  const { draft } = state;
  const connectors: Connectors = {
    googleIngest: clientOf(draft.googleIngest),
    xero: clientOf(draft.xero),
  };
  const common = { port: portOf(draft.port), imageTag: state.release, connectors };
  if (state.mode === "desktop") {
    return { mode: "desktop", ...common };
  }
  const signIn: SignIn =
    draft.signInKind === "email"
      ? { kind: "email", apiKey: draft.emailApiKey.trim(), from: draft.emailFrom.trim() }
      : {
          kind: "google",
          clientId: draft.googleClientId.trim(),
          clientSecret: draft.googleClientSecret.trim(),
        };
  return {
    mode: "server",
    ...common,
    bind: draft.bind.trim(),
    publicUrl: draft.publicUrl.trim(),
    adminEmail: draft.adminEmail.trim(),
    signIn,
  };
}

/** Where the wizard opens: at settings over an install, at Docker after a restart, else first. */
function firstStep(boot: Boot): Step {
  if (boot.existing !== null) {
    return "settings";
  }
  return boot.resume === null ? "language" : "docker";
}

export function initialState(boot: Boot): WizardState {
  return {
    step: firstStep(boot),
    locale: boot.locale,
    mode: boot.existing?.mode ?? boot.resume?.mode ?? "desktop",
    release: boot.release,
    platform: boot.platform,
    reconfigure: boot.existing !== null,
    draft: draftFrom(boot.dir, boot.existing),
    showProblems: false,
    docker: {
      state: null,
      offer: null,
      busy: null,
      restartNeeded: false,
      restartFailed: false,
      installFailed: false,
    },
    install: IDLE_INSTALL,
    url: null,
  };
}
