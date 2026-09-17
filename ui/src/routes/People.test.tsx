/**
 * The invitation token is shown exactly once, and the interface has to say so.
 *
 * The API returns the token on creation and stores only its digest, so the
 * moment it appears is the only moment it exists in readable form. An interface
 * that shows it in a toast, or in a panel that closes on the next state change,
 * loses it -- and the operator finds out days later, when the person they
 * invited cannot sign in and there is nothing to resend.
 *
 * These tests fail if the token stops being shown, if the warning that it is not
 * shown again is dropped as clutter, or if it stops surviving an unrelated
 * re-render of the page around it.
 */

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { People } from "@/routes/People";
import { renderApp } from "@/test/render";
import { CASE_A, store } from "@/test/store";

function show(isStaff = true) {
  return renderApp(<People tenantId={CASE_A} isStaff={isStaff} />);
}

async function invite(email: string) {
  await userEvent.type(await screen.findByLabelText(/email address/i), email);
  await userEvent.click(screen.getByRole("button", { name: /create invitation/i }));
}

describe("creating an invitation", () => {
  test("shows the token and says it will not be shown again", async () => {
    show();
    await invite("finance@case-a1b2c3.example");

    expect(await screen.findByText(/invite-finance-case-a1b2c3-example-once/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /not shown again/i })).toBeInTheDocument();
  });

  test("says what to do when it is lost, because it cannot be recovered", async () => {
    show();
    await invite("finance@case-a1b2c3.example");

    // "Contact support" would be a lie: only a digest is stored, so nobody can
    // retrieve it. Issuing a fresh invitation is the only real recovery.
    expect(await screen.findByText(/invite .* again and a new one is issued/i)).toBeInTheDocument();
  });

  test("the token stays until it is put away", async () => {
    show();
    await invite("finance@case-a1b2c3.example");
    const token = await screen.findByText(/invite-finance-case-a1b2c3-example-once/);

    // Typing another address must not clear the one value that cannot be
    // regenerated.
    await userEvent.type(screen.getByLabelText(/email address/i), "second@case-a1b2c3.example");

    expect(token).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /put it away/i }));
    expect(
      screen.queryByText(/invite-finance-case-a1b2c3-example-once/),
    ).not.toBeInTheDocument();
  });
});

describe("who may invite", () => {
  test("a non-staff member is not offered the form", async () => {
    show(false);

    // The real router refuses this with a 403. Showing a form that is going to
    // be refused teaches nothing and wastes a decision.
    expect(await screen.findByRole("heading", { name: /who can see this customer/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create invitation/i })).not.toBeInTheDocument();
  });
});

describe("removing someone", () => {
  test("asks first, in place", async () => {
    store.members[CASE_A] = [
      {
        id: "user-9",
        email: "finance@case-a1b2c3.example",
        display_name: "Finance",
        is_staff: false,
        role: "member",
      },
    ];

    show();
    await userEvent.click(await screen.findByRole("button", { name: /^remove$/i }));

    expect(screen.getByText(/remove finance@case-a1b2c3.example\?/i)).toBeInTheDocument();
    // The list is still there: revoking access is confirmed without losing the
    // context that tells you whether it is the right person.
    expect(screen.getByRole("columnheader", { name: /person/i })).toBeInTheDocument();
  });

  test("keeping them leaves their access untouched", async () => {
    store.members[CASE_A] = [
      {
        id: "user-9",
        email: "finance@case-a1b2c3.example",
        display_name: "Finance",
        is_staff: false,
        role: "member",
      },
    ];

    show();
    await userEvent.click(await screen.findByRole("button", { name: /^remove$/i }));
    await userEvent.click(screen.getByRole("button", { name: /keep/i }));

    expect(await screen.findByText("finance@case-a1b2c3.example")).toBeInTheDocument();
    expect(store.members[CASE_A]).toHaveLength(1);
  });
});
