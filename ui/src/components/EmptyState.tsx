/**
 * An empty state that teaches the interface.
 *
 * "Nothing here" wastes the one moment the user is looking for guidance. Each
 * of these says what will appear, why it is worth having, and what to do — which
 * is the whole of onboarding for a screen someone reaches before there is data.
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
    <div className="empty">
      <p className="empty__title">{title}</p>
      <p className="empty__body">{body}</p>
      {action}
    </div>
  );
}
