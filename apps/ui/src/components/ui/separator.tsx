/**
 * shadcn-scaffolded (`bunx shadcn@4.21.0 add separator`), then stripped of its default
 * Tailwind visual classes per docs/adr/0025. Depends on `@radix-ui/react-separator` directly
 * (not the `radix-ui` umbrella package the CLI reached for, which bundles roughly forty
 * primitives this app does not use for the one it needs here).
 *
 * No baked-in look: every current call site (the `band-rule` divider before a section head in
 * `QuestionBands.tsx`, `DashboardBands.tsx`, `DashboardFilterEditor.tsx`, `QuestionResult.tsx`)
 * supplies `className="band-rule"`, whose rule in index.css is unchanged by this adoption.
 * `decorative` defaults to `true`, matching what these dividers already are: a printed rule
 * between sections, not a boundary a screen reader needs announced as `role="separator"`.
 */

import { Root as SeparatorPrimitiveRoot } from "@radix-ui/react-separator";
import type * as React from "react";

import { cn } from "@/lib/utils.ts";

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitiveRoot>): React.JSX.Element {
  return (
    <SeparatorPrimitiveRoot
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(className)}
      {...props}
    />
  );
}

export { Separator };
