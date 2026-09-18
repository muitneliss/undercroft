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
 */

// biome-ignore-all lint/correctness/noUndeclaredVariables: Globals the runtime supplies that Biome's resolver does not model -- Bun's own `Bun`, and DOM globals in .tsx files. tsc resolves all of them, and tsc is the check that binds here.
export const RELEASE: string = __UNDERCROFT_RELEASE__;
