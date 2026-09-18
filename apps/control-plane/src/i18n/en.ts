/**
 * English, for the colleagues and auditors who do not read Vietnamese.
 *
 * `vi.ts` decides which keys exist; this file answers them, and `index.ts` makes that a
 * typecheck rather than a hope. Most of this is the wording the control plane shipped with.
 */

export const en = {
  invitation: {
    subject: "You have access to Undercroft",
    body: [
      "You have been given access to {{tenantId}} in Undercroft.",
      "",
      "Sign in at {{publicUrl}} — use this address ({{email}}) exactly, either with Google or by asking for a one-time code.",
      "",
      "If you were not expecting this, you can ignore it; nothing happens until you sign in.",
    ].join("\n"),
  },

  signInCode: {
    subject: "Your Undercroft sign-in code",
    body: [
      "Your sign-in code is {{otp}}",
      "",
      "It expires in {{minutes}} minutes. If you did not ask to sign in, you can ignore this email.",
    ].join("\n"),
  },

  error: {
    notInvited:
      "That address has not been invited. Ask an administrator for an invitation, and sign in with the exact address it was sent to.",
    alreadyMember: "{{email}} already has access as {{role}}.",
    noOpenInvitation: "No open invitation with that id.",
    requiresRole: "This action requires the {{role}} role.",
    requiresSuperadmin: "This action requires platform administrator access.",
    tenantExists: "The reference {{tenantId}} is already in use by another customer.",
  },
};
