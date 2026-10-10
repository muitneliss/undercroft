# 119. Who has access to a customer is read by its admin alone

- Status: Accepted
- Date: 2026-10-10
- Follows: [ADR 0010](0010-invite-only-sign-in-with-better-auth.md) (the roster and invitations
  managed in the product), [ADR 0012](0012-tab-strip-at-the-head-not-the-fore-edge.md) (a locked
  division renders face-down), [ADR 0013](0013-superadmins-named-in-the-environment.md) (a
  superadmin holds `admin` in every customer), [ADR 0113](0113-every-action-is-in-the-audit-log-and-people-can-read-it.md)
  (a person's own actions are read at Account)

## Context

The People division had two halves with different gates. Its four writes (`people.invite`,
`people.setRole`, `people.removeMember`, `people.revokeInvitation`) were `requireRole("admin")`;
its two reads, `people.members` and `people.invitations`, were plain `tenantProcedure`. So a
`viewer` or a `member` could open People and read every address with access to the customer,
with its role, and every open invitation -- in the browser, and equally through the CLI, `/mcp`
and the assistant, which call the same router.

The requirement (#425) is that only an admin of the customer reads that page at all. The roster
and the open invitations are the customer's access list: every address that can reach its
connected accounts, and every one that soon may. Only an admin manages it, and nothing a member
or a viewer can do is informed by reading it. What a member does want from People -- "what did
I do here" -- has been answered at Account since ADR 0113 (`audit.mine`), for every customer at
once.

## Decision

1. **`people.members` and `people.invitations` are `requireRole("admin")`**, like the writes
   beside them. A viewer or member is refused with FORBIDDEN. A superadmin passes with no extra
   code, because `accessIn` already resolves them to `admin` in every existing customer.
   Because the gate is on the router, every door -- browser, CLI, `/mcp`, the assistant -- is
   closed by the same line, and the procedure sentences that CLI help and MCP tool descriptions
   print now carry the admin suffix the other admin procedures carry.
2. **A division can be admin-only, declared once.** `Division.adminOnly` in
   `apps/ui/src/lib/divisions.ts`, read through one function, `closedTo(division, reader)`, which
   answers why a division will not open for a reader (`no-customer`, `admin-only`) or `null`.
   People is the only admin-only division.
3. **The book, not the page, decides.** `Book`'s `leafPage` already waits for `tenants.get`
   before mounting a division, and already prints `DeactivatedNotice` in place of one
   (ADR 0110). It now also prints `AdminOnlyNotice` in place of an admin-only division for a
   reader whose role is known and is not admin. The division is never mounted, so a member's
   browser sends no `people.*` request at all, whether they followed a link or typed the
   address. The notice says only an admin of this customer can open it, names the reader's
   role, and points at their own activity on Account.
4. **The tab turns face-down for the role, as for no customer.** `TabRail` asks the same
   `closedTo`, so the tab and the leaf cannot disagree; the face-down tab carries the role
   reason in its title and in its accessible name. The customer page's directory draws the
   People entry the same way: named, unlinked, with the reason.
5. **An unknown role closes nothing.** While `tenants.get` is pending the leaf shows the
   skeleton and the tab stays live; if `tenants.get` is refused, the division renders and
   reports its own refusal, as before. Closing on a guess would turn over an admin's own tab;
   leaving it open on a guess costs, at worst, a refusal the division prints itself, because
   the server is the control.

## Consequences

- The role statements on People were wrong once the gate moved: a viewer no longer "sees who
  has access and who is invited". They are reworded in both catalogues, and the admin's now
  says it sees who has access and reads everything done in the customer (`audit.tenant`).
- `People.tsx` keeps its `isAdmin` checks, which no longer decide anything an ordinary reader
  sees. Removing them is a separate simplification.
- The village's People houses (ADR 0116) still link to the division for every reader; a
  member who presses one lands on the notice, which is the correct answer, not a refusal.
- Visual baselines that render a book as a `member` or `viewer` show People face-down and need
  retaking with `task ci:visual-update`.

## Options rejected

- **Hide the People tab from a non-admin.** ADR 0012: nothing vanishes. A division that
  disappears teaches nobody it exists, and a member who has been told "ask an admin" needs to
  know there is a place an admin works.
- **Leave the reads open and only hide the page.** The browser is one door of four; the CLI,
  `/mcp` and the assistant reach the router directly. Hiding is courtesy, the server is the
  control, and the requirement is about the data, not the page.
- **Gate inside `People.tsx`**, enabling its queries only for an admin. The page would own a
  rule the tab strip and the directory also need, so the rule would be written three times; and
  the frame already waits on `tenants.get` and already owns "what stands in for a division".
- **NOT_FOUND instead of FORBIDDEN.** NOT_FOUND protects a customer's existence from somebody
  who is not a member of it, and that boundary is unchanged (`tenantProcedure` answers it
  before the role gate runs). A viewer or member already knows the customer exists, so
  FORBIDDEN tells them nothing new, and it is what every other admin read (`keys.list`,
  `lake.query`, `audit.tenant`) answers.
- **A minimum role per division instead of a flag.** More general, but only one division needs
  it, and an `admin`-only reason is worded once where a ranked one would need a sentence per
  rank. The flag can become a rank when a second rank is needed.
