# Access control: roles and grants

What a person may do in a customer is a set of permissions. Every customer has the four built-in
roles; this runbook is how a customer defines roles of its own, grants one permission to a role
or a person, makes a grant expire, and takes access away -- in the web UI, with the CLI, and over
MCP. What each permission covers, and every bound, is the
[permissions reference](../reference/permissions.md); why it works this way is
[ADR 0139](../adr/0139-tenant-access-is-casbin-policy.md) and
[ADR 0141](../adr/0141-custom-roles-and-grants-under-the-subset-rule.md).

## Before you start

- **Who may.** Defining roles and giving grants needs `roles:manage`; reading the grants and
  giving someone a role needs `people:manage`. An `admin` holds both.
- **The subset rule.** You can give, grant or take away only permissions you hold yourself. A
  person holding `roles:manage` but not `keys:manage` cannot define a role holding
  `keys:manage`, grant it, or invite anyone at such a role. The refusal names what you lack.
- **Choose the smallest change.** A role the customer already has, if one holds exactly what the
  person needs; a grant, for one more permission or one for a while; a new role, when several
  people need the same set.

## In the web UI

Open the customer, then **People**.

### Define a role

1. Choose **Roles**. The table lists the four built-ins and the customer's own roles, with what
   each holds and how many people hold it.
2. Under **Define a role**, fill in the key (lowercase letters, digits and underscores, starting
   with a letter, such as `accountant`; it cannot be changed later), the display name, and an
   optional description.
3. Tick the permissions. A box for a permission you do not hold is locked.
4. Press **Define role**.

To change a role's permissions, press **Edit permissions…** on its row, tick, and press **Save
permissions**; **Cancel** discards the ticks. A built-in role has no Edit: it cannot be changed.

To delete a role, press **Delete…** and then the plate that names it. A role somebody holds, or
an open invitation names, is not deleted: move those people to another role, or withdraw the
invitations, first. Every grant to the role goes with it.

### Give someone a role

On **Members**, choose the role in the person's row; to invite somebody new at it, use the form
on **Invitations**. Both list every role the customer has; a role of its own shows its display
name with its key beside it.

### Grant a permission, and make it expire

1. Choose **Grants**. The table lists every grant, including expired ones.
2. Under **Grant a permission**, choose whom it is for -- a role, or a person on the roster --
   and the permission.
3. To make it expire, pick the last day it holds. It holds until the end of that day in
   Singapore time (SGT), the zone every date in Undercroft is shown in. Leave it empty for a
   grant that does not expire.
4. Press **Grant**.

An expired grant stays in the list, marked expired, and holds nothing. Granting the same
permission to the same subject again moves its expiry rather than adding a second grant.

### Take a grant away

On **Grants**, press **Take away…** on its row, then the plate naming whose it is. Removing a
person from the customer takes every grant to them away as well.

## With the CLI

The commands are the procedures, one per command (`undercroft describe roles save --agent`
lists each one's flags). A write needs a profile that allows writes; run it with `--dry-run`
first to see the request.

Read what you hold, and the roles there are:

```sh
undercroft tenants get --tenant-id CASE-0042 --agent
undercroft roles list --tenant-id CASE-0042 --agent
```

Define a role. Its permissions are an array, so they go in the JSON input:

```sh
undercroft roles save --tenant-id CASE-0042 --key accountant --label "Accountant" \
  --description "Reads reports and the raw lake" --create \
  --input-json '{"permissions":["reports:author","lake:read"]}'
```

Without `--create` the same command replaces the role's label, description and permissions, and
answers `unchanged: true` when nothing differs. Delete one with
`undercroft roles delete --tenant-id CASE-0042 --key accountant --yes`.

Give a person the role, or invite them at it:

```sh
undercroft people set-role --tenant-id CASE-0042 --email lan@example.test --role accountant
undercroft people invite --tenant-id CASE-0042 --email new@example.test --role accountant
```

Grant one permission to a person until the end of 31 October, Singapore time, or to every holder
of a role with no expiry:

```sh
undercroft grants save --tenant-id CASE-0042 --email lan@example.test \
  --permission lake:read --expires-at 2026-10-31T23:59:59+08:00
undercroft grants save --tenant-id CASE-0042 --role member --permission lake:read
```

List the grants, for everybody or for one subject, and take one away by its `id`:

```sh
undercroft grants list --tenant-id CASE-0042 --email lan@example.test --agent
undercroft grants delete --tenant-id CASE-0042 --id <id from grants list> --yes
```

## Over MCP

The tools are the same procedures with `.` as `_`: `roles_list`, `roles_get`, `roles_save`,
`roles_delete`, `grants_list`, `grants_save` and `grants_delete`, beside `people_setRole` and
`people_invite`. Each takes the same input as the CLI command above, as JSON; `roles_save`, `roles_delete`, `grants_save` and `grants_delete` need a connection with a
write grant. An agent with the `undercroft-access-control` skill
([agent skills](agent-skills.md)) turns a sentence such as "let Lan read the raw data until the
end of the month" into one of these calls and asks before making it.

## When it is refused

| Refusal                            | What it means, and what to do                                                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FORBIDDEN`, `PERMISSION_REQUIRED` | You lack the permission the command itself needs (`roles:manage`, or `people:manage`). Ask someone who holds it.                                    |
| `FORBIDDEN`, `PERMISSION_NOT_HELD` | The subset rule: `permissions` lists what you would give or take away without holding it. Ask someone who holds those, such as an admin.            |
| `NOT_FOUND`, `ROLE_NOT_FOUND`      | The customer has no role with that key. `roles list` shows the keys.                                                                                |
| `NOT_FOUND`, `NOT_MEMBER`          | A grant to a person needs them to be a member. Invite them first.                                                                                   |
| `CONFLICT`, `ROLE_IN_USE`          | The role is held or named by an open invitation; `members` and `invitations` say how many.                                                          |
| `CONFLICT`, `ROLE_TAKEN`           | `--create` with a key in use. Edit that role, or choose another key.                                                                                |
| `BAD_REQUEST`, `BUILT_IN_ROLE`     | `viewer`, `member`, `builder` and `admin` cannot be saved or deleted. Define a role of your own.                                                    |
| `BAD_REQUEST`, `EXPIRY_PASSED`     | The expiry is not in the future.                                                                                                                    |
| `CONFLICT` on the last admin       | A customer keeps someone holding `admin`. A role of the customer's own never counts as `admin`, whatever it holds: make someone else `admin` first. |

## Not possible yet

A permission covers the whole customer: `lake:read` reads all of the raw lake. Grants on one
model, one raw source or entity, or one report or dashboard, and rules on rows and columns, are
planned for later releases.
