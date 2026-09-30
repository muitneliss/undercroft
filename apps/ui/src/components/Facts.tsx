/**
 * A row of facts about one thing -- a run, a model, a customer -- set as ruled columns: each
 * fact a caption over its value, under a hairline, four to a line on a wide leaf and two on a
 * phone. What the reader asks of the thing before reading any further down.
 *
 * One component for every such row, because the three copies it replaced had already started
 * to differ in markup, and a fact row that looks one way under a run and another under a model
 * reads as two kinds of object. A description list, so a screen reader hears each caption with
 * its value rather than a run of loose words.
 *
 * The value is whatever the caller hands in -- text, a mark, a link -- set as a datum; a value
 * the caller does not have is the caller's to render as MISSING, never an empty cell here.
 */

import type { ReactNode } from "react";

/** The row itself; its children are `Fact`s. */
export function Facts({ children }: { children: ReactNode }): React.JSX.Element {
  return <dl className="facts">{children}</dl>;
}

/** One caption over one value. */
export function Fact({
  label,
  children,
  quiet = false,
}: {
  label: string;
  children: ReactNode;
  /** A value read only when something is wrong -- an id, a build tag -- sits back one tone. */
  quiet?: boolean;
}): React.JSX.Element {
  return (
    <div className="facts__fact">
      <dt className="label">{label}</dt>
      <dd className={quiet ? "datum datum--quiet" : "datum"}>{children}</dd>
    </div>
  );
}
