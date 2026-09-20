/**
 * shadcn-scaffolded (`bunx shadcn@4.21.0 add skeleton`), then restyled per docs/adr/0025: the
 * generated version pulses opacity on an eased `animate-pulse`, which is exactly the motion
 * this design forbids (ADR 0014 -- `steps(n, end)` only, never easing). `setting` is
 * this app's own placeholder-line rule already: a `steps(6, end)` marching dash, reduced to
 * none under `prefers-reduced-motion`. `@/components/Skeleton.tsx` (the `rows`/aria-busy/i18n
 * component every call site actually uses) renders one of these per line.
 */

import type * as React from "react";

import { cn } from "@/lib/utils.ts";

function Skeleton({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element {
  return <div data-slot="skeleton" className={cn("setting", className)} {...props} />;
}

export { Skeleton };
