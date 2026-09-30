import { describe, expect, it } from "bun:test";
import type { Answers } from "@undercroft/setup/answers";
import type { Boot } from "../rpc.ts";
import { plan, problemsOf } from "./rules.ts";
import { createWizardStore, type WizardStore } from "./store.ts";
import { answersOf, type Step } from "./wizard.ts";

const BOOT: Boot = {
  release: "v1.55.0",
  platform: "darwin",
  locale: "vi",
  dir: "/Users/ada/.undercroft",
  existing: null,
  resume: null,
};

const SERVER: Answers = {
  mode: "server",
  port: 14_000,
  imageTag: "v1.50.0",
  bind: "127.0.0.1",
  publicUrl: "https://data.example.test",
  adminEmail: "ada@example.test",
  signIn: { kind: "google", clientId: "client.apps.example.test", clientSecret: "sign-in-secret" },
  connectors: { googleIngest: null, xero: { clientId: "xero-id", clientSecret: "xero-secret" } },
};

/** A new install's wizard, walked forward to `step` the way a person would, Docker ready. */
function at(step: Step, mode: Answers["mode"] = "desktop"): WizardStore {
  const store = createWizardStore(BOOT);
  const wizard = store.getState;
  wizard().next();
  wizard().chooseMode(mode);
  wizard().next();
  if (step === "docker") {
    return store;
  }
  wizard().dockerChecked({ state: "ready", composeVersion: "2.29.0" });
  wizard().next();
  if (step === "settings") {
    return store;
  }
  wizard().edit({
    publicUrl: "https://data.example.test",
    adminEmail: "ada@example.test",
    emailApiKey: "re_example",
    emailFrom: "Undercroft <no-reply@example.test>",
  });
  wizard().next();
  return store;
}

describe("the Docker step", () => {
  it("keeps a person there until Docker answers ready", () => {
    const store = at("docker");
    expect(store.getState().step).toBe("docker");

    store.getState().next();
    expect(store.getState().step).toBe("docker");

    store.getState().dockerChecked({ state: "stopped" });
    store.getState().next();
    expect(store.getState().step).toBe("docker");

    store.getState().dockerChecked({ state: "ready", composeVersion: "2.29.0" });
    store.getState().next();
    expect(store.getState().step).toBe("settings");
  });

  it("sends an install back to it when Docker stops answering mid-way", () => {
    const store = at("connectors");
    store.getState().next();
    store.getState().installStarted();
    store.getState().installEnded({ ok: false, reason: "docker", state: { state: "stopped" } });

    expect(store.getState().step).toBe("docker");
  });
});

describe("the settings step", () => {
  it("stops a server install until it has an https address, an administrator and a sign-in", () => {
    const store = at("settings", "server");
    store.getState().next();

    expect(store.getState().step).toBe("settings");
    expect(store.getState().showProblems).toBe(true);
    expect(problemsOf(store.getState()).map((problem) => problem.field)).toEqual([
      "publicUrl",
      "adminEmail",
      "signIn",
    ]);

    store.getState().edit({
      publicUrl: "http://data.example.test",
      adminEmail: "ada@example.test",
      emailApiKey: "re_example",
      emailFrom: "Undercroft <no-reply@example.test>",
    });
    store.getState().next();
    expect(problemsOf(store.getState())).toEqual([
      { field: "publicUrl", code: "public-url-not-https" },
    ]);

    store.getState().edit({ publicUrl: "https://data.example.test" });
    store.getState().next();
    expect(store.getState().step).toBe("connectors");
  });

  it("asks a desktop install for none of them", () => {
    const store = at("settings", "desktop");
    store.getState().next();

    expect(store.getState().step).toBe("connectors");
  });
});

describe("the connectors step", () => {
  it("can be skipped, even half-filled, and then installs no client", () => {
    const store = at("connectors");
    store.getState().editConnector("xero", { enabled: true, clientId: "xero-id" });
    store.getState().next();
    expect(store.getState().step).toBe("connectors");
    expect(problemsOf(store.getState())).toEqual([{ field: "xero", code: "incomplete" }]);

    store.getState().skipConnectors();

    expect(store.getState().step).toBe("install");
    expect(answersOf(store.getState()).connectors).toEqual({ googleIngest: null, xero: null });
  });
});

describe("re-opening over an existing install", () => {
  it("starts at settings with that install's answers, and keeps its secrets", () => {
    const store = createWizardStore({ ...BOOT, existing: SERVER });

    expect(store.getState().step).toBe("settings");
    expect(store.getState().reconfigure).toBe(true);
    // The answers come back as they were written, moved to this app's release as every start is.
    expect(answersOf(store.getState())).toEqual({ ...SERVER, imageTag: "v1.55.0" });
    expect(plan(store.getState()).secrets).toBe("keep");

    // Its language, mode and Docker were settled when it was installed; there is no way back to
    // a first step that would make it look like a new install.
    store.getState().back();
    expect(store.getState().step).toBe("settings");
  });

  it("is the only case that keeps them: a new install generates its own", () => {
    expect(plan(at("connectors").getState()).secrets).toBe("generate");
  });
});
