/**
 * shadcn-scaffolded (`bunx shadcn@4.21.0 add badge`), then stripped down per docs/adr/0025.
 * The generated version ships a `cva` variant set (colour-filled pills) and an `asChild`/`Slot`
 * escape hatch this app has no use for -- every call site here is `StatusMark.tsx`, which
 * already computes its own `mark mark--{granted,pending,lapsed,absent}` className and must
 * keep doing so: shape and word carry the state, hue is the least load-bearing signal
 * (`.claude/rules/` and `StatusMark.tsx`'s own docstring, WCAG 2.1 AA 1.4.1). A colour-filled
 * pill would make hue primary again, which is the regression this file exists to not make.
 */

import type * as React from "react";

import { cn } from "@/lib/utils.ts";

function Badge({ className, ...props }: React.ComponentProps<"span">): React.JSX.Element {
  return <span data-slot="badge" className={cn(className)} {...props} />;
}

export { Badge };
