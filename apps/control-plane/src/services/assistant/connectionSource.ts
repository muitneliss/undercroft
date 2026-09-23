import { z } from "zod";

/**
 * Which connection a write names: the `source` id `connections.list` returned, VERBATIM.
 *
 * Not the kind. A tenant may hold several Gmail mailboxes, each a source of its own --
 * `gmail`, `gmail.3fa9c1d2e0ab` (ADR 0043) -- and "pause Gmail" said to a tool that took the
 * kind would pause whichever one it happened to mean. A pattern rather than an enum because the
 * account key is not known until a mailbox is connected; it is in the JSON schema the model
 * reads, and the procedure behind the tool refuses a source the tenant does not have anyway.
 */
export const ConnectionSource = z
  .string()
  .regex(/^(?<kind>hubspot|xero|(?<google>gmail|drive)(?<account>\.[0-9a-f]{12})?)$/u)
  .describe(
    "The exact `source` id sourceStatus returned for this account, e.g. gmail.3fa9c1d2e0ab",
  );
