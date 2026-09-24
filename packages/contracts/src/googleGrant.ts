/**
 * The one Google permission each byte source must hold to read what its scope names.
 *
 * Two processes need this fact and neither may own it alone. The control plane ASKS for it at
 * consent (`oauthProviders.ts`) and marks a grant that lacks it `needs_reconnect`; the worker
 * REFUSES to read without it, because a grant that lacks it does not fail at Google -- a Drive
 * listing under `drive.file` answers 200 with nothing in it, and the run that read it closed
 * green having landed nothing (issue 178). One table here, so the scope a consent asks for and
 * the scope a run insists on cannot drift apart. ADR 0047.
 */

import { sourceKind } from "./sourceInstance.ts";

export const GOOGLE_READ_SCOPES = {
  gmail: "https://www.googleapis.com/auth/gmail.readonly",
  /**
   * `drive.readonly`, not `drive.file`. Under `drive.file` a folder picked in Google's Picker
   * does not grant its existing contents, so a folder pick could never be read. ADR 0047
   * supersedes the half of ADR 0016 that chose `drive.file`.
   */
  drive: "https://www.googleapis.com/auth/drive.readonly",
} as const;

const READ_SCOPE_BY_KIND: ReadonlyMap<string, string> = new Map(Object.entries(GOOGLE_READ_SCOPES));

/**
 * The read scope a recorded Google grant lacks, or `null` when it lacks nothing.
 *
 * `null` also for an EMPTY recorded scope, which means nothing was recorded rather than
 * nothing was granted -- a row predating the column, or a source that does not consent through
 * Google. No evidence is not a verdict in either direction (CLAUDE.md rule 2), and the card's
 * `presentStatus` reads an empty scope the same way. By kind, so a second account is held to
 * the same scope as the first. A source with no read scope here lacks nothing.
 */
export function missingReadScope(source: string, grantedScope: string): string | null {
  const needed = READ_SCOPE_BY_KIND.get(sourceKind(source));
  if (needed === undefined || grantedScope.trim() === "") {
    return null;
  }
  return grantedScope.split(" ").includes(needed) ? null : needed;
}
