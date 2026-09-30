/**
 * An email address set so that, in a narrow column, it breaks after its "@" and nowhere else.
 *
 * A datum breaks anywhere (`.datum`), which is right for a hash and wrong for an address:
 * "operator@e / xample.test" is read as two words, neither of them the address. The break
 * opportunity after the "@" gives the line one place to turn, and `.address` stops the datum's
 * break-anywhere from shrinking the column below the longer half -- so the table widens the
 * column to hold "example.test" whole rather than splitting it. A half longer than the whole
 * column still breaks rather than pushing the row's plates off the screen.
 */

export function Address({ email }: { email: string }): React.JSX.Element {
  const at = email.lastIndexOf("@");
  if (at < 0) {
    return <span className="address">{email}</span>;
  }
  return (
    <span className="address">
      {email.slice(0, at + 1)}
      <wbr />
      {email.slice(at + 1)}
    </span>
  );
}
