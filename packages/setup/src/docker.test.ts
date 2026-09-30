import { expect, it } from "bun:test";
import { detectDocker } from "./docker.ts";
import { tableRunner } from "./testing.ts";

const CLIENT = { "docker --version": { stdout: "Docker version 28.4.0" } };
const DAEMON = "docker info --format {{.ServerVersion}}";
const COMPOSE = "docker compose version --short";

it.each([
  ["no docker program", { "docker --version": { code: 127 } }, { state: "missing" }],
  [
    "a socket this user may not open",
    {
      ...CLIENT,
      [DAEMON]: {
        code: 1,
        stderr: "permission denied while trying to connect to the Docker daemon socket",
      },
    },
    { state: "no-permission" },
  ],
  [
    "a daemon that does not answer",
    {
      ...CLIENT,
      [DAEMON]: {
        code: 1,
        stderr: "Cannot connect to the Docker daemon. Is the docker daemon running?",
      },
    },
    { state: "stopped" },
  ],
  [
    "no Compose v2 plugin",
    {
      ...CLIENT,
      [DAEMON]: { stdout: "28.4.0" },
      [COMPOSE]: { code: 1, stderr: "'compose' is not a docker command." },
    },
    { state: "no-compose" },
  ],
  [
    "everything the stack needs",
    { ...CLIENT, [DAEMON]: { stdout: "28.4.0" }, [COMPOSE]: { stdout: "2.39.2\n" } },
    { state: "ready", composeVersion: "2.39.2" },
  ],
] as const)("reads %s as the state to tell a person", async (_, table, state) => {
  expect(await detectDocker(tableRunner(table))).toEqual(state);
});
