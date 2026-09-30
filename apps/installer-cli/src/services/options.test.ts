import { describe, expect, it } from "bun:test";
import type { Answers } from "@undercroft/setup";
import { answersFromFlags, type Flags, parseInvocation } from "./options.ts";

function flags(argv: readonly string[]): Flags {
  const parsed = parseInvocation(argv);
  if (!parsed.ok) {
    throw new Error(parsed.detail);
  }
  return parsed.invocation.flags;
}

const SERVER: Answers = {
  mode: "server",
  port: 13_000,
  imageTag: "v1.50.0",
  bind: "127.0.0.1",
  publicUrl: "https://data.example.test",
  adminEmail: "ada@example.test",
  signIn: { kind: "google", clientId: "client.apps.example.test", clientSecret: "shh" },
  connectors: { googleIngest: null, xero: { clientId: "xero-id", clientSecret: "xero-secret" } },
};

describe("answersFromFlags", () => {
  it("installs this installer's release on the desktop with nothing but --yes", () => {
    expect(answersFromFlags(flags(["--yes"]), null, "v1.55.0")).toEqual({
      answers: {
        mode: "desktop",
        port: 13_000,
        imageTag: "v1.55.0",
        connectors: { googleIngest: null, xero: null },
      },
      problems: [],
    });
  });

  it("refuses a bind address on a desktop install, which is loopback by definition", () => {
    const { problems } = answersFromFlags(
      flags(["--yes", "--mode", "desktop", "--bind", "0.0.0.0"]),
      null,
      "v1.55.0",
    );

    expect(problems).toEqual([{ field: "bind", code: "desktop-bind" }]);
  });

  it("changes only the answer a re-run names, keeping the install's sign-in and connectors", () => {
    const { answers, problems } = answersFromFlags(
      flags(["--yes", "--port", "14000"]),
      SERVER,
      "v1.55.0",
    );

    expect(problems).toEqual([]);
    expect(answers).toEqual({ ...SERVER, port: 14_000, imageTag: "v1.55.0" });
  });

  it("names what a server install is missing rather than guessing it", () => {
    const argv = [
      "--yes",
      "--mode",
      "server",
      "--public-url",
      "https://data.example.test",
      "--admin",
      "ada@example.test",
    ];

    expect(answersFromFlags(flags(argv), null, "v1.55.0").problems).toEqual([
      { field: "signIn", code: "incomplete" },
    ]);
  });
});

describe("parseInvocation", () => {
  it("refuses a mode it does not know instead of installing a desktop", () => {
    expect(parseInvocation(["--mode", "cloud"])).toEqual({ ok: false, detail: "--mode cloud" });
  });
});
