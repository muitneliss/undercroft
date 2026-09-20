/**
 * shadcn-scaffolded (`bunx shadcn@4.21.0 add table`), then stripped of its default Tailwind
 * visual classes per docs/adr/0025: these are semantic wrappers only, no baked-in look beyond
 * the one `table` class every table in this app already shares. `.table`'s own rules in
 * index.css address `th`/`td`/`tbody tr`/`caption` as descendants, so the sub-components below
 * need no class of their own -- only `Table` itself carries a default, and every other
 * classification (`.datum`, `.datum--quiet`, `.result__type`, ...) stays exactly where each
 * call site already puts it.
 */

import type * as React from "react";

import { cn } from "@/lib/utils.ts";

function Table({ className, ...props }: React.ComponentProps<"table">): React.JSX.Element {
  return <table data-slot="table" className={cn("table", className)} {...props} />;
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">): React.JSX.Element {
  return <thead data-slot="table-header" className={cn(className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">): React.JSX.Element {
  return <tbody data-slot="table-body" className={cn(className)} {...props} />;
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">): React.JSX.Element {
  return <tfoot data-slot="table-footer" className={cn(className)} {...props} />;
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">): React.JSX.Element {
  return <tr data-slot="table-row" className={cn(className)} {...props} />;
}

function TableHead({ className, ...props }: React.ComponentProps<"th">): React.JSX.Element {
  return <th data-slot="table-head" className={cn(className)} {...props} />;
}

function TableCell({ className, ...props }: React.ComponentProps<"td">): React.JSX.Element {
  return <td data-slot="table-cell" className={cn(className)} {...props} />;
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">): React.JSX.Element {
  return <caption data-slot="table-caption" className={cn(className)} {...props} />;
}

export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow };
