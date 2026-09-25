/**
 * Which build this is.
 *
 * One value, read once, from the stamp `vite.config.ts` writes into the bundle. Nothing
 * else in the app may name `__UNDERCROFT_RELEASE__`, so there is a single place to look
 * when the answer on screen is wrong.
 *
 * ## Why a build-time constant and not an endpoint
 *
 * The SPA and the control plane ship in ONE image (`deploy/Dockerfile.control-plane`
 * builds the bundle in its first stage and serves it from the second), so a round trip to
 * ask the server which release is running could only return what the bundle was already
 * built from. It would cost a request, a procedure and three layers to learn nothing.
 *
 * ## What it promises, and the one case where it is approximate
 *
 * In a shipped image this is exact: the image is built from the release commit, where
 * release-please has already written `version` and cut `v<version>` from it. The string
 * is therefore the literal tag, and the literal value of `IMAGE_TAG` that rolls back to
 * it.
 *
 * In a working tree between releases it names the release the tree DESCENDS from, which
 * is the most an unreleased tree can truthfully say about itself -- it has no tag. That is
 * a narrower claim than the screen makes, so it is written down here rather than dressed
 * up on the page.
 *
 * ## Which release the server has moved on to
 *
 * The one question the stamp cannot answer about itself is whether it is still current: a
 * tab open across a deploy keeps the bundle it loaded. The release beacon (`vite.config.ts`,
 * ADR 0055) is a service worker built alongside the bundle and carrying the same stamp, so
 * when the browser installs a new one, that worker names the release a reload would load.
 */

export const RELEASE: string = __UNDERCROFT_RELEASE__;

/** A release tag as release-please cuts it; the only answer from a worker that is evidence. */
const TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

/**
 * The release that has replaced this tab's, from what a newly installed beacon answered --
 * or null when nothing has.
 *
 * Null for this tab's own release, which is what a first install and a tab loaded after the
 * deploy both hear. Null, too, for an answer that is not a tag: silence or garbage from a
 * worker is no evidence that a reload would change anything, and a notice to reload that
 * reloads into the same build is one the reader learns to ignore. A different tag is
 * reported whichever way it points, because a rollback leaves a stale tab exactly as stale.
 */
export function replacedBy(answer: unknown): string | null {
  return typeof answer === "string" && TAG.test(answer) && answer !== RELEASE ? answer : null;
}
