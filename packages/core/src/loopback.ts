/**
 * Whether a URL is served on this machine only.
 *
 * Two sides ask it and must agree. The control plane refuses to build the local sign-in method
 * behind any other origin (`devSignIn.ts`, ADR 0094), and lets plain HTTP carry an OAuth
 * resource only here (`mcpAuth.ts`). The CLI asks it before it tries that sign-in (ADR 0096), so
 * a person pointing `--local` at a server hears why at once, in their language, instead of after
 * a request that could only be refused. One set of names, so the courtesy check can never refuse
 * what the server would accept, or wave through what it will refuse.
 *
 * Its own subpath, `@undercroft/core/loopback`, because the root barrel reaches `node:crypto`
 * and the CLI's bundle and the browser want nothing from it.
 */

/** The hosts a program on this machine reaches a local stack on, as `URL#hostname` spells them. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** `false` for a string that is not a URL at all: an unreadable address is not this machine. */
export function isLoopbackOrigin(url: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}
