/**
 * An install's answers as `.env` settings, and back.
 *
 * The one place that knows which variable carries which answer. `installation.ts` writes what
 * `settingsFor` returns and reads what `answersFrom` returns; nothing else names these keys, so
 * a variable the compose file renames changes here and nowhere above.
 *
 * `UNDERCROFT_INSTALL_MODE` is the installer's own line. Compose ignores a variable no service
 * names, and without it a desktop install and a server install bound to loopback could not be
 * told apart when read back.
 */

import {
  type Answers,
  DESKTOP_OWNER,
  installUrl,
  type OAuthClient,
  type SignIn,
} from "./answers.ts";

/**
 * `UNDERCROFT_SUPERADMINS` for a server install: the administrator the wizard asked for, first,
 * then whoever a person added after it by hand. A re-run replaces the one it owns and keeps the
 * rest, and `answersFrom` reads the first entry back as that answer.
 */
function superadmins(adminEmail: string, held: string): string {
  const others = held
    .split(",")
    .slice(1)
    .map((entry) => entry.trim())
    .filter(Boolean);
  // Normalised as the control plane normalises (ADR 0013), so the two always agree.
  return [adminEmail.trim().toLowerCase(), ...others].join(",");
}

/** What the answers decide, every key written every time: a cleared answer clears its line. */
export function settingsFor(
  answers: Answers,
  held: ReadonlyMap<string, string>,
): Map<string, string> {
  const desktop = answers.mode === "desktop";
  const signIn = answers.mode === "server" ? answers.signIn : null;
  const email = signIn?.kind === "email" ? signIn : null;
  const google = signIn?.kind === "google" ? signIn : null;
  const { googleIngest, xero } = answers.connectors;
  return new Map([
    ["UNDERCROFT_INSTALL_MODE", answers.mode],
    ["IMAGE_TAG", answers.imageTag],
    ["UNDERCROFT_BIND", answers.mode === "server" ? answers.bind : "127.0.0.1"],
    ["UNDERCROFT_PORT_API", String(answers.port)],
    ["UNDERCROFT_PUBLIC_URL", installUrl(answers)],
    [
      "UNDERCROFT_SUPERADMINS",
      answers.mode === "server"
        ? superadmins(answers.adminEmail, held.get("UNDERCROFT_SUPERADMINS") ?? "")
        : DESKTOP_OWNER,
    ],
    // The same address as the superadmin: the owner signs in as the one person with authority.
    ["UNDERCROFT_DEV_SIGN_IN_AS", desktop ? DESKTOP_OWNER : ""],
    ["UNDERCROFT_EMAIL_API_KEY", email?.apiKey ?? ""],
    ["UNDERCROFT_EMAIL_FROM", email?.from ?? ""],
    ["UNDERCROFT_GOOGLE_CLIENT_ID", google?.clientId ?? ""],
    ["UNDERCROFT_GOOGLE_CLIENT_SECRET", google?.clientSecret ?? ""],
    ["UNDERCROFT_GOOGLE_INGEST_CLIENT_ID", googleIngest?.clientId ?? ""],
    ["UNDERCROFT_GOOGLE_INGEST_CLIENT_SECRET", googleIngest?.clientSecret ?? ""],
    ["UNDERCROFT_XERO_CLIENT_ID", xero?.clientId ?? ""],
    ["UNDERCROFT_XERO_CLIENT_SECRET", xero?.clientSecret ?? ""],
  ]);
}

function clientOf(
  env: ReadonlyMap<string, string>,
  id: string,
  secret: string,
): OAuthClient | null {
  const clientId = env.get(id) ?? "";
  const clientSecret = env.get(secret) ?? "";
  return clientId === "" && clientSecret === "" ? null : { clientId, clientSecret };
}

/** `settingsFor` read backwards: the answers an install's `.env` was written from. */
export function answersFrom(env: ReadonlyMap<string, string>): Answers | null {
  const mode = env.get("UNDERCROFT_INSTALL_MODE");
  const common = {
    port: Number.parseInt(env.get("UNDERCROFT_PORT_API") ?? "", 10),
    imageTag: env.get("IMAGE_TAG") ?? "",
    connectors: {
      googleIngest: clientOf(
        env,
        "UNDERCROFT_GOOGLE_INGEST_CLIENT_ID",
        "UNDERCROFT_GOOGLE_INGEST_CLIENT_SECRET",
      ),
      xero: clientOf(env, "UNDERCROFT_XERO_CLIENT_ID", "UNDERCROFT_XERO_CLIENT_SECRET"),
    },
  };
  if (mode === "desktop") {
    return { mode, ...common };
  }
  if (mode !== "server") {
    return null;
  }
  const apiKey = env.get("UNDERCROFT_EMAIL_API_KEY") ?? "";
  const google = clientOf(env, "UNDERCROFT_GOOGLE_CLIENT_ID", "UNDERCROFT_GOOGLE_CLIENT_SECRET");
  const signIn: SignIn =
    apiKey === "" && google !== null
      ? { kind: "google", ...google }
      : { kind: "email", apiKey, from: env.get("UNDERCROFT_EMAIL_FROM") ?? "" };
  return {
    mode,
    ...common,
    bind: env.get("UNDERCROFT_BIND") ?? "127.0.0.1",
    publicUrl: env.get("UNDERCROFT_PUBLIC_URL") ?? "",
    // The first superadmin is the one the wizard asked for; any added by hand stay in `.env`.
    adminEmail: (env.get("UNDERCROFT_SUPERADMINS") ?? "").split(",")[0]?.trim() ?? "",
    signIn,
  };
}

export const ENV_HEADER = [
  "# Undercroft's install settings, written by the setup wizard (docs/runbook/install.md).",
  "#",
  "# BACK THIS FILE UP. UNDERCROFT_SECRET_KEY seals every stored token, and the passwords below",
  "# are the ones the data volumes were created with: lose this file and the data it guards",
  "# cannot be opened. The wizard never regenerates a value that is already here, and keeps any",
  "# line you add -- an assistant key, a Lark webhook.",
  "",
].join("\n");

/**
 * Where this machine reaches the published control plane, whatever the public URL says: a
 * server's https origin may not route yet when the wizard checks, because the operator's proxy
 * comes after the install.
 */
export function localOrigin(answers: Answers): string {
  const bind = answers.mode === "server" && answers.bind !== "0.0.0.0" ? answers.bind : "127.0.0.1";
  return `http://${bind}:${answers.port}`;
}
