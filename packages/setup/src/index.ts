/**
 * `@undercroft/setup`: installing Undercroft on one machine with Docker (ADR 0095).
 *
 * UI-agnostic by construction. Nothing here reads the environment, writes to a terminal or
 * words a sentence; every front end -- the terminal wizard in `apps/installer-cli`, and the GUI
 * wizard after it -- hands in how to run a program, fetch and tell the time, and words the
 * codes it gets back in its reader's language.
 */

export {
  type Answers,
  type Connectors,
  DESKTOP_OWNER,
  type DesktopAnswers,
  type Field,
  installUrl,
  isEmailAddress,
  type Mode,
  type OAuthClient,
  type Problem,
  type ProblemCode,
  type ServerAnswers,
  type SignIn,
  validateAnswers,
} from "./answers.ts";
export { COMPOSE_FILE, PROJECT } from "./composeFile.ts";
export {
  type Arch,
  type Command,
  type DockerInstallPlan,
  type DockerState,
  detectDocker,
  dockerInstallPlan,
  hasBrew,
  installDocker,
  type Platform,
} from "./docker.ts";
export {
  COMPOSE_FILE_NAME,
  ENV_FILE,
  type Fetch,
  type HealthResult,
  type Installation,
  type InstallationDeps,
  installation,
  type WriteResult,
} from "./installation.ts";
export type { ServiceStatus, StepResult } from "./composeOutput.ts";
export {
  NOT_FOUND,
  processRunner,
  type RunOptions,
  type RunResult,
  type Runner,
} from "./runner.ts";
export { generateSecrets, SECRET_NAMES, type SecretName } from "./secrets.ts";
