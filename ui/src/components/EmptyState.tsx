/**
 * An unprinted leaf: the same object, with no ink on it yet.
 *
 * "Nothing here" wastes the one moment the user is looking for guidance. Each of
 * these says what will appear, why it is worth having, and what to do -- which
 * is the whole of onboarding for a screen someone reaches before there is data.
 *
 * It is deliberately not a dashed placeholder box. A dashed box is a hole in the
 * page; an unprinted leaf is a page that has not been printed yet, which is the
 * true statement and the more inviting one.
 */

import type { ReactNode } from "react";

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="unprinted stack">
      <p className="unprinted__title">{title}</p>
      <p className="prose">{body}</p>
      {action}
    </div>
  );
}
