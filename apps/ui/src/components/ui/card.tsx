/**
 * shadcn-scaffolded (`bunx shadcn@4.21.0 add card`), then stripped of its default Tailwind
 * visual classes per docs/adr/0025 -- no rounded corners, no shadow, no background of its own.
 * Bare semantic wrappers only; a caller supplies the look via `className`, exactly as
 * `QuestionCard.tsx`'s `grid__head`/`grid__body` already do.
 *
 * `Card` itself renders a `<div>`, which is why `QuestionCard.tsx` keeps its own `<section
 * aria-label>` as the outer element instead of using this -- a `<section>` with an accessible
 * name is an ARIA region landmark; a `<div>` with the same label is not, and swapping it for
 * `Card` would drop that landmark silently. Only the header/content split is adopted.
 */

import type * as React from "react";

import { cn } from "@/lib/utils.ts";

function Card({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element {
  return <div data-slot="card" className={cn(className)} {...props} />;
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element {
  return <div data-slot="card-header" className={cn(className)} {...props} />;
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element {
  return <div data-slot="card-title" className={cn(className)} {...props} />;
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element {
  return <div data-slot="card-description" className={cn(className)} {...props} />;
}

function CardAction({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element {
  return <div data-slot="card-action" className={cn(className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element {
  return <div data-slot="card-content" className={cn(className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element {
  return <div data-slot="card-footer" className={cn(className)} {...props} />;
}

export { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
