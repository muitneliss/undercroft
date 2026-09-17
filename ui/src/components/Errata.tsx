/**
 * The correction slip.
 *
 * A publisher tips an errata slip into a book when something already printed is
 * wrong and cannot be unprinted. That is exactly the shape of a lapsed grant: the
 * schedule still says the source is connected, the customer still believes it
 * is, and the record is wrong until someone acts.
 *
 * Vermilion is held out of the seven-hue section wheel so that this slip is the
 * only thing in the entire interface wearing it. That is the whole reason the
 * wheel has a colour missing from it -- an alert colour that also appears as a
 * section, a chart series or a hover state is not an alert colour.
 *
 * `role="alert"` is deliberate and is not used for anything routine. This
 * component is for a state that needs a person, which is why it also insists on
 * carrying its own recovery action rather than describing one.
 */

import type { ReactNode } from "react";

import { Errata as ErrataMark } from "@/components/Icon";

export function Errata({
  heading,
  children,
  action,
  live = false,
}: {
  heading: string;
  children: ReactNode;
  action?: ReactNode;
  /** Announce it when it appears. For a state that arrived, not one already on the page. */
  live?: boolean;
}) {
  return (
    <div className="errata" {...(live ? { role: "alert" } : {})}>
      <span className="errata__mark">
        <ErrataMark size={13} />
        {heading}
      </span>
      <div className="errata__body">{children}</div>
      {action}
    </div>
  );
}
