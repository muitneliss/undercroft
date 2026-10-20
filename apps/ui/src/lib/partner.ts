/**
 * Where a reader learns about Kanna, the partner product the foot of every page credits.
 *
 * Kanna is a separate product -- a self-hosted web interface for the Claude Code and Codex
 * agents -- and one of the MCP clients that reach Undercroft through `/mcp`. Its public
 * documentation, rather than its source repository, is the address, because that is the page
 * that says what it is to a reader who has never heard of it.
 *
 * Written once because two places link it -- the colophon and the title page's agent section --
 * and a partner credit that points two ways is one of them pointing nowhere. The blog keeps its
 * own copy in `apps/blog/src/site.ts`, as it does for every address it shares with this app:
 * the two are separate builds and neither imports the other.
 */
export const KANNA_URL = "https://kanna-wiki.lowbit.link";
