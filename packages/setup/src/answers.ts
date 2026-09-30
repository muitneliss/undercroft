/**
 * What a person decides about an install, and whether it can run.
 *
 * Two modes, and the difference is who signs in (ADR 0095):
 *
 * - **desktop** -- one person, this machine. The control plane is published on loopback only,
 *   and its one owner is signed in without proof, which the control plane allows on loopback
 *   alone (ADR 0094). So a desktop install has no bind address to choose: a desktop answer
 *   that could name `0.0.0.0` would be one the control plane refuses at boot.
 * - **server** -- a team. A public https origin behind the operator's own reverse proxy, an
 *   administrator named in `UNDERCROFT_SUPERADMINS` (ADR 0013), and a sign-in method that
 *   proves an address: a mail key for one-time codes, or a Google client.
 *
 * `validateAnswers` returns problems as CODES, never sentences. This package is below every
 * front end -- the terminal wizard now, a GUI later -- and each words a problem in the reader's
 * language itself.
 */

export type Mode = "desktop" | "server";

/** An OAuth client a person registered with a provider. No secret ships in the installer. */
export interface OAuthClient {
  readonly clientId: string;
  readonly clientSecret: string;
}

/** Optional ingestion clients. HubSpot needs none: a private-app token is pasted per tenant. */
export interface Connectors {
  /** The SECOND Google client, for Gmail and Drive -- never the sign-in one (ADR 0016). */
  readonly googleIngest: OAuthClient | null;
  readonly xero: OAuthClient | null;
}

export type SignIn =
  | { readonly kind: "email"; readonly apiKey: string; readonly from: string }
  | ({ readonly kind: "google" } & OAuthClient);

interface Common {
  /** The host port the control plane is published on. */
  readonly port: number;
  /** The release the images are pulled at, `vX.Y.Z`. */
  readonly imageTag: string;
  readonly connectors: Connectors;
}

export interface DesktopAnswers extends Common {
  readonly mode: "desktop";
}

export interface ServerAnswers extends Common {
  readonly mode: "server";
  /** The address the port binds to. Loopback when a reverse proxy runs on the same host. */
  readonly bind: string;
  /** The https origin the browser uses, which the operator's proxy terminates. */
  readonly publicUrl: string;
  readonly adminEmail: string;
  readonly signIn: SignIn;
}

export type Answers = DesktopAnswers | ServerAnswers;

/**
 * The address a desktop install's owner signs in as. It never receives mail -- nothing proves it,
 * on loopback nothing has to -- and `.local` is reserved, so it can never be somebody's real
 * mailbox that a later server install would hand administrator rights to.
 */
export const DESKTOP_OWNER = "owner@undercroft.local";

export type Field =
  | "port"
  | "imageTag"
  | "bind"
  | "publicUrl"
  | "adminEmail"
  | "signIn"
  | "googleIngest"
  | "xero";

export type ProblemCode =
  /** Not a whole number from 1 to 65535. */
  | "port-invalid"
  /** Not `vX.Y.Z` -- a moving tag would make a restart run different bytes. */
  | "image-tag-invalid"
  /** Not an IPv4 address. */
  | "bind-invalid"
  | "public-url-invalid"
  /** A server's origin is not https: its session cookie would cross the network in clear. */
  | "public-url-not-https"
  | "admin-email-invalid"
  /** A sign-in method, or a connector client, with a part left empty. */
  | "incomplete"
  /** A quote or a line break, which the `.env` file cannot carry literally. */
  | "unwritable";

export interface Problem {
  readonly field: Field;
  readonly code: ProblemCode;
}

const IMAGE_TAG = /^v\d+\.\d+\.\d+$/u;
const OCTET = /^\d{1,3}$/u;
const WHITESPACE = /\s/u;
const TRAILING_SLASH = /\/$/u;
const UNWRITABLE = /['\r\n]/u;
const MAX_PORT = 65_535;
const MAX_OCTET = 255;

/** One `@`, something either side, no whitespace: the control plane's own test (ADR 0013). */
export function isEmailAddress(value: string): boolean {
  const at = value.indexOf("@");
  return (
    at > 0 && at === value.lastIndexOf("@") && at < value.length - 1 && !WHITESPACE.test(value)
  );
}

function isIpv4(value: string): boolean {
  const octets = value.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => OCTET.test(octet) && Number.parseInt(octet, 10) <= MAX_OCTET)
  );
}

function urlProblem(value: string): ProblemCode | null {
  if (!URL.canParse(value)) {
    return "public-url-invalid";
  }
  const url = new URL(value);
  if (url.protocol !== "https:") {
    return "public-url-not-https";
  }
  // An origin, not a page: Better Auth appends its own paths to it.
  return url.pathname === "/" && url.search === "" && url.hash === "" ? null : "public-url-invalid";
}

function clientProblems(field: Field, client: OAuthClient | null): Problem[] {
  if (client === null) {
    return [];
  }
  return filled(client.clientId) && filled(client.clientSecret)
    ? []
    : [{ field, code: "incomplete" }];
}

function filled(value: string): boolean {
  return value.trim() !== "";
}

function signInProblems(signIn: SignIn): Problem[] {
  const parts =
    signIn.kind === "email" ? [signIn.apiKey, signIn.from] : [signIn.clientId, signIn.clientSecret];
  return parts.every(filled) ? [] : [{ field: "signIn", code: "incomplete" }];
}

/** Every string an answer carries, by the field a problem with it is reported against. */
function strings(answers: Answers): [Field, string][] {
  const { googleIngest, xero } = answers.connectors;
  const clients: [Field, string][] = [
    ...(googleIngest === null
      ? []
      : ([
          ["googleIngest", googleIngest.clientId],
          ["googleIngest", googleIngest.clientSecret],
        ] satisfies [Field, string][])),
    ...(xero === null
      ? []
      : ([
          ["xero", xero.clientId],
          ["xero", xero.clientSecret],
        ] satisfies [Field, string][])),
  ];
  if (answers.mode === "desktop") {
    return clients;
  }
  const signIn: [Field, string][] =
    answers.signIn.kind === "email"
      ? [
          ["signIn", answers.signIn.apiKey],
          ["signIn", answers.signIn.from],
        ]
      : [
          ["signIn", answers.signIn.clientId],
          ["signIn", answers.signIn.clientSecret],
        ];
  return [
    ...clients,
    ...signIn,
    ["publicUrl", answers.publicUrl],
    ["adminEmail", answers.adminEmail],
  ];
}

/** Everything wrong with `answers`, or an empty list when an install can be written from them. */
export function validateAnswers(answers: Answers): Problem[] {
  const problems: Problem[] = [];
  if (!Number.isInteger(answers.port) || answers.port < 1 || answers.port > MAX_PORT) {
    problems.push({ field: "port", code: "port-invalid" });
  }
  if (!IMAGE_TAG.test(answers.imageTag)) {
    problems.push({ field: "imageTag", code: "image-tag-invalid" });
  }
  problems.push(
    ...clientProblems("googleIngest", answers.connectors.googleIngest),
    ...clientProblems("xero", answers.connectors.xero),
  );
  if (answers.mode === "server") {
    if (!isIpv4(answers.bind)) {
      problems.push({ field: "bind", code: "bind-invalid" });
    }
    const url = urlProblem(answers.publicUrl);
    if (url !== null) {
      problems.push({ field: "publicUrl", code: url });
    }
    if (!isEmailAddress(answers.adminEmail)) {
      problems.push({ field: "adminEmail", code: "admin-email-invalid" });
    }
    problems.push(...signInProblems(answers.signIn));
  }
  const unwritable = new Set(
    strings(answers)
      .filter(([, value]) => UNWRITABLE.test(value))
      .map(([field]) => field),
  );
  problems.push(...[...unwritable].map((field): Problem => ({ field, code: "unwritable" })));
  return problems;
}

/**
 * The URL a person opens: loopback on the desktop, the public origin on a server.
 *
 * A desktop install is `localhost`, not `127.0.0.1`, although it is published on the second:
 * Xero accepts a plain-http redirect URI for `localhost` alone, and Google treats the two as
 * different URIs, so the name is the one a person can register with every provider. The
 * browser resolves it to the published loopback address either way.
 */
export function installUrl(answers: Answers): string {
  return answers.mode === "desktop"
    ? `http://localhost:${answers.port}`
    : answers.publicUrl.replace(TRAILING_SLASH, "");
}
