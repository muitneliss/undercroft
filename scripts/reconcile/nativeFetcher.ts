/**
 * A fetcher over Bun's own `fetch`, for the live run.
 *
 * `bun test` preloads happy-dom for the UI suites (`bunfig.toml`), and happy-dom replaces the
 * global `fetch` with a browser one that enforces the same-origin policy -- so under the test
 * runner a server-side call to Google or HubSpot is refused as cross-origin. `Bun.fetch` is the
 * runtime's native client, untouched by the preload, so the live test reads the sources the
 * same way the CLI does.
 */

import type {
  Fetcher,
  HttpRequest,
  HttpResponse,
} from "../../packages/connector-runtime/src/fetcher.ts";

export function nativeFetcher(timeoutMs = 60_000): Fetcher {
  return {
    async send(request: HttpRequest): Promise<HttpResponse> {
      // No AbortController: the preload replaces it too, and Bun.fetch rejects a foreign
      // signal. A timer raced against the call bounds it instead.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${request.method} timed out after ${timeoutMs} ms`)),
          timeoutMs,
        );
      });
      try {
        const response = await Promise.race([
          Bun.fetch(request.url, {
            method: request.method,
            headers: request.headers,
            ...(request.body === undefined ? {} : { body: request.body }),
          }),
          timeout,
        ]);
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key.toLowerCase()] = value;
        });
        return { status: response.status, headers, text: await response.text() };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
