/**
 * Smoke-test a deployment's `/mcp` the way a model-context client meets it. ADR 0060.
 *
 * `TOKEN=upat_… task dev:mcp-smoke URL=http://localhost:13000/mcp` -- the token minted on the
 * account page. Three checks, each one a thing a person setting up Claude Code would otherwise
 * find out by watching it fail:
 *
 * 1. With no bearer, `/mcp` answers 401 and its `WWW-Authenticate` names the protected-resource
 *    metadata a client follows. Without that, a client has no way to learn how to get a token.
 * 2. With the token, the real MCP client connects and lists tools. Their count is split by what
 *    each one may do, so a read token that lists a write is visible at a glance.
 * 3. `session_me` answers with the token owner's address -- the credential resolves to the
 *    person who minted it, which is the whole claim a personal token makes.
 *
 * The token arrives in the environment (`MCP_TOKEN`), never on this process's command line, where
 * every other user of the machine could read it from the process list. Nothing is printed of it but
 * its `upat_…` id.
 */

import process from "node:process";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

interface Target {
  readonly url: URL;
  readonly token: string;
}

function targetFromEnv(env: NodeJS.ProcessEnv): Target {
  const url = env.MCP_URL ?? "";
  const token = env.MCP_TOKEN ?? "";
  if (url === "" || token === "") {
    throw new Error("usage: TOKEN=upat_… task dev:mcp-smoke URL=<origin>/mcp");
  }
  return { url: new URL(url), token };
}

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** Check 1: the challenge an unauthenticated client gets. */
async function challenged(url: URL): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  const challenge = response.headers.get("www-authenticate") ?? "";
  if (response.status !== 401 || !challenge.includes("resource_metadata=")) {
    throw new Error(
      `no bearer: expected 401 with resource_metadata, got ${String(response.status)} ${challenge}`,
    );
  }
  say(`ok  no bearer -> 401, ${challenge}`);
}

/** Checks 2 and 3, through the real client. */
async function listedAndIdentified(target: Target): Promise<void> {
  const client = new Client({ name: "undercroft-mcp-smoke", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(target.url, {
      requestInit: { headers: { authorization: `Bearer ${target.token}` } },
    }),
  );
  try {
    const { tools } = await client.listTools();
    const reads = tools.filter((tool) => tool.annotations?.readOnlyHint === true).length;
    const destructive = tools.filter((tool) => tool.annotations?.destructiveHint === true).length;
    say(
      `ok  ${String(tools.length)} tools: ${String(reads)} read, ` +
        `${String(tools.length - reads - destructive)} write, ${String(destructive)} destructive`,
    );

    const me = await client.callTool({ name: "session_me", arguments: {} });
    const email: unknown = Reflect.get(me.structuredContent ?? {}, "email");
    if (me.isError === true || typeof email !== "string") {
      throw new Error(`session_me did not answer with an address: ${JSON.stringify(me.content)}`);
    }
    say(`ok  token ${target.token.split(".")[0] ?? ""} speaks for ${email}`);
  } finally {
    await client.close();
  }
}

async function main(): Promise<void> {
  const target = targetFromEnv(process.env);
  await challenged(target.url);
  await listedAndIdentified(target);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
