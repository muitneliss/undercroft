---
title: ADR 0119 Who Has Access to a Customer Is Read by Its Admin Alone
type: source
date: 2026-10-10
tags: []
source: docs/adr/0119-who-has-access-is-read-by-an-admin-alone.md
source_path: docs/adr/0119-who-has-access-is-read-by-an-admin-alone.md
source_hash: a9920c4212a10dff3bdf67b5abcf6d451a6a7c6733b805ac7e05e7971e9f670b
ingested: 2026-10-10
---

# ADR 0119 Who Has Access to a Customer Is Read by Its Admin Alone

Makes the People division admin-only, reads included (#425). Follows [[ADR 0010 Invite-Only Sign-In with Better Auth]] (roster and invitations managed in the product), [[ADR 0012 The Tab Strip Crosses the Head]] (a locked division renders face-down), [[ADR 0013 Superadmins Named in the Environment]] (a superadmin holds `admin` in every customer) and [[ADR 0113 Every Action Is in the Audit Log and People Can Read It]] (a person's own actions are read at Account).

Context. People's four writes were `requireRole("admin")`, but its two reads, `people.members` and `people.invitations`, were plain `tenantProcedure`, so a viewer or member could read every address with access and every open invitation -- in the browser and through the CLI, `/mcp` and the assistant, which call the same router. The roster and the open invitations are the customer's access list; only an admin manages it, and what a member wants from People ("what did I do here") is already answered at Account by `audit.mine`.

Decision. (1) Both reads are `requireRole("admin")`; a viewer or member gets FORBIDDEN, a superadmin passes because `accessIn` resolves them to `admin`; the procedure sentences printed by CLI help and MCP tool descriptions carry the admin suffix. (2) `Division.adminOnly` in `apps/ui/src/lib/divisions.ts`, read through one function, `closedTo(division, reader)`, answering `no-customer`, `admin-only` or `null`; People is the only admin-only division. (3) `Book`'s `leafPage`, which already waits on `tenants.get` and prints `DeactivatedNotice` ([[ADR 0110 A Tenant Can Be Deactivated]]), prints `AdminOnlyNotice` in place of an admin-only division for a reader whose known role is not admin, so the division never mounts and sends no `people.*` request; the notice names the reader's role and points at their own activity on Account. (4) `TabRail` asks the same `closedTo`, so the tab turns face-down with the role reason in its title and accessible name; the customer page's directory draws the entry the same way, unlinked. (5) An unknown role (pending or refused `tenants.get`) closes nothing: closing on a guess would turn over an admin's own tab, and the server stays the control.

Consequences: the role statements on People are reworded in both catalogues (a viewer no longer "sees who has access"; the admin's adds seeing who has access and reading everything done in the customer); `People.tsx` keeps `isAdmin` checks that no longer decide anything; the village's People houses ([[ADR 0116 The Journal Can Be Read as a Village, Drawn in WebGL and Moved in Stop-Motion]]) still link to the division and land a member on the notice; visual baselines that render a book as member or viewer need retaking.

Rejected: hiding the tab (ADR 0012, nothing vanishes); leaving the reads open and hiding only the page (the browser is one door of four); gating inside `People.tsx` (the rule would be written three times, and the frame already owns what stands in for a division); NOT\_FOUND instead of FORBIDDEN (a member already knows the customer exists, the non-member boundary is unchanged, and every other admin read answers FORBIDDEN); a minimum role per division (one division needs it, and an admin-only reason is worded once).
