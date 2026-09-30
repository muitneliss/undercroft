import { describe, expect, it } from "bun:test";
import { type Answers, type ServerAnswers, validateAnswers } from "./answers.ts";

const SERVER: ServerAnswers = {
  mode: "server",
  port: 13_000,
  imageTag: "v1.55.0",
  bind: "127.0.0.1",
  publicUrl: "https://data.example.test",
  adminEmail: "ada@example.test",
  signIn: { kind: "email", apiKey: "re_example", from: "Undercroft <no-reply@example.test>" },
  connectors: { googleIngest: null, xero: null },
};

describe("validateAnswers", () => {
  it("accepts a desktop install and a server install that can run", () => {
    const desktop: Answers = {
      mode: "desktop",
      port: 13_000,
      imageTag: "v1.55.0",
      connectors: { googleIngest: null, xero: { clientId: "x", clientSecret: "y" } },
    };
    expect(validateAnswers(desktop)).toEqual([]);
    expect(validateAnswers(SERVER)).toEqual([]);
  });

  it.each([
    [
      "an http origin",
      { publicUrl: "http://data.example.test" },
      "publicUrl",
      "public-url-not-https",
    ],
    [
      "a page rather than an origin",
      { publicUrl: "https://x.test/app" },
      "publicUrl",
      "public-url-invalid",
    ],
    ["no administrator", { adminEmail: "" }, "adminEmail", "admin-email-invalid"],
    [
      "a mail key with no sender",
      { signIn: { kind: "email", apiKey: "k", from: " " } },
      "signIn",
      "incomplete",
    ],
    ["a bind that is not an address", { bind: "example.test" }, "bind", "bind-invalid"],
    ["a moving release", { imageTag: "latest" }, "imageTag", "image-tag-invalid"],
    [
      "a value .env cannot quote",
      { adminEmail: "o'brien@example.test" },
      "adminEmail",
      "unwritable",
    ],
  ] as const)("refuses a server install with %s", (_, change, field, code) => {
    expect(validateAnswers({ ...SERVER, ...change })).toEqual([{ field, code }]);
  });
});
