/** Lights the public home from the pointer, outside the cover's own film; `@/lib/vault/lamp.ts`. */

import { type RefObject, useEffect } from "react";

import { lightPage } from "@/lib/vault/lamp.ts";

export function usePageLamp(pageRef: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const page = pageRef.current;
    return page === null ? undefined : lightPage(page);
  }, [pageRef]);
}
