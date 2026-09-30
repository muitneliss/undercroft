# 94. A local install signs its owner in on loopback

- Status: Accepted
- Date: 2026-09-30
- Related: [ADR 0010](0010-invite-only-sign-in-with-better-auth.md) (Better Auth, invite-only),
  [ADR 0013](0013-superadmins-named-in-the-environment.md) (superadmins named in the environment).
  The installer that writes the configuration below is ADR 0095.

## Context

Undercroft is to be installable with one click, on a desktop as well as on a server, the whole
stack in Docker. A desktop install has one person in it, on the machine the server runs on, and
usually nothing to sign in with: no Google client and no mail key, both of which need an account
somewhere and a domain or a verified sender. Until now such a person met a sign-in page they could
not pass.

The repository already has a way in that needs neither. `UNDERCROFT_DEV_SIGN_IN_AS` adds
`POST /api/auth/sign-in/dev` (`apps/control-plane/src/handlers/devSignIn.ts`): a Better Auth method
that issues an ordinary session for the configured address, asks the invite-only gate first, takes
no input, and refuses to be built at all unless `UNDERCROFT_PUBLIC_URL` is loopback. It was a
developer's tool: only `task dev:api` passed it, and its button was compiled only into the Vite
development build, so a production bundle could not have offered it even where the server did.

The SPA also had no way to learn which methods a server offers. It drew the Google button and the
code form everywhere, whatever was configured.

## Decision

1. **The local method is a shipped mode for a desktop install, not only a developer's tool.** The
   installer writes a loopback `UNDERCROFT_PUBLIC_URL` (`http://localhost:<port>`, the port
   published on `127.0.0.1` only), one generated owner address as both `UNDERCROFT_DEV_SIGN_IN_AS`
   and `UNDERCROFT_SUPERADMINS`, and no Google or mail configuration. The owner is therefore
   admissible with no invitation (ADR 0013) and holds the platform's authority, which a fresh
   install needs to create its first customer.
2. **Safety rests on the refusal that already exists, at construction, plus one on the request.**
   `devSignIn` throws unless the public URL is loopback, so a desktop `.env` copied to a server
   stops the process at boot with the reason, and the server compose file never passes the
   variable. Loopback alone is not enough once the machine belongs to somebody who browses the
   web: a page can point its own name at `127.0.0.1` (DNS rebinding) and post to the endpoint as a
   same-origin request, and with no cookie yet Better Auth's origin check never runs. So the
   endpoint now also refuses a request not addressed to the public URL's own host, which a
   rebound page cannot fake. The installer must therefore send the browser to exactly the public
   URL's origin; a page opened on `127.0.0.1` when it says `localhost` is refused and told which
   address to use. Otherwise the method is unchanged: same endpoint, same gate, same ordinary
   session.
3. **The server tells the page which ways in it offers**, through a public procedure,
   `config.signIn`, answering `{ methods }` from the list `createAuth` built -- the same list the
   boot log prints, so the two cannot differ. It names methods, never the address the local
   method signs in as.
4. **The page signs the owner in by itself only when `dev` is the ONLY method offered.** It says
   so while it works, and shows the server's refusal with a retry rather than trying again in a
   loop. Offered beside Google or mail, the local method stays a button: somebody configured a
   method that proves something, and the page does not choose for them. A desktop install's root
   goes to that sign-in rather than to the public introduction, which has no public to introduce
   there.
5. **The first-party images are published for `linux/amd64` and `linux/arm64`**, one manifest
   list per tag, so the same one-click install runs on Apple Silicon and on ARM servers. The
   Dokploy host still pulls amd64 from the list. This reverses the amd64-only note in
   `build-images.yml`, whose reason was that nothing pulled arm64; a desktop install now does.
   Every third-party image the server compose file names already publishes arm64.

## Consequences

- A desktop owner opens the address the installer printed and is in the book, with no sign-in
  screen and no click.
- The local method's button is now shown because the server offers it, not because the bundle is
  a development build. A developer's stack with no mail key is signed in without a click too; one
  given a mail key keeps the button.
- The sign-in page makes one more request, batched with `session.me`.
- Anything that can reach the loopback port under the public URL's host name -- another program
  on the machine, or a browser tab the owner opens there -- can sign in as the owner. That is the
  trust a desktop install places in its own machine, the same a developer's stack always placed;
  it is why the method never leaves loopback.
- An image build now emulates arm64 on the amd64 runner (QEMU), which costs build time on a
  release. The SPA stage is pinned to the build platform, so only the parts that differ by
  architecture are built twice.
- The CLI still signs in by emailed code only; a desktop owner uses it with a personal access token
  minted on `/account`.

## Options rejected

- **A "no auth" mode that bypasses Better Auth for a local install.** It would create a second kind
  of caller: every gate, the session table, sign-out and `resolveCaller` would have to know about a
  request with no session behind it, and the first one that forgot would be an open door. The local
  method already yields an ordinary session, so nothing downstream learns anything new.
- **A new variable (`UNDERCROFT_LOCAL_OWNER`, or similar) beside `UNDERCROFT_DEV_SIGN_IN_AS`.** Two
  switches for one door. They would have to agree about the address, the loopback refusal and the
  gate, and the day they disagreed nobody would know which one a running server had honoured.
- **Keep the click.** The people a one-click install is for are not the people who know why a page
  offers them a button labelled "local" and nothing else. A screen with one possible action is not
  a choice, and asking for it adds friction and no safety -- the safety is the loopback refusal.
- **Decide in the bundle (`import.meta.env`, a build flag, a separate desktop image).** The same
  production image runs on a server and on a laptop, and only the server knows which it is.
- **Build arm64 on native runners and merge the manifests.** Faster than emulation and free of it,
  but twice the workflow for a build that runs once per release; the emulated build is the smaller
  change, and the native one remains open if a release's build time becomes the problem.
