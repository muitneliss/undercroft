/**
 * The page a deploy took away: said on the leaf, with the Reload that brings it back.
 *
 * A chunk that no longer exists rejects its `React.lazy`, and with no boundary above it React
 * unmounts the entire application -- the tab rail, the running head, everything -- into a blank
 * page that only F5 recovers. `@/lib/staleChunk` reloads the tab itself when that loses
 * nothing; when it would lose an unsaved draft it keeps the tab, and this is what the reader
 * then sees in place of the page: why it did not open and the one action that fixes it, with
 * the rest of the book still working, so the draft can be saved first. ADR 0070.
 *
 * Only a failure `@/lib/staleChunk` reported is answered here. Any other error is thrown on
 * to whatever is above, exactly as it was before this existed: a page that crashed is not a
 * newer release, and saying it is would send the reader to reload a bug.
 *
 * A class because an error boundary has no hook form in React 19. What it holds is React's
 * own record of the failure below it, not application state, so it is not the store's (see
 * `.claude/rules/state.md`); it resets when the leaf it sits in is remounted, which the
 * book's key does on every change of division.
 */

import { Component, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Errata } from "@/components/Errata.tsx";
import { isStaleChunk } from "@/lib/staleChunk.ts";

function reload(): void {
  globalThis.location.reload();
}

function StaleChunkNotice(): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <Errata
      heading={t("app.staleChunk")}
      live={true}
      action={
        <button type="button" className="plate" onClick={reload}>
          {t("app.reload")}
        </button>
      }
    >
      {t("app.staleChunkBody")}
    </Errata>
  );
}

type Caught = { readonly failed: false } | { readonly failed: true; readonly error: unknown };

export class StaleChunkBoundary extends Component<{ children: ReactNode }, Caught> {
  override state: Caught = { failed: false };

  static getDerivedStateFromError(error: unknown): Caught {
    return { failed: true, error };
  }

  override render(): ReactNode {
    if (!this.state.failed) {
      return this.props.children;
    }
    if (isStaleChunk(this.state.error)) {
      return <StaleChunkNotice />;
    }
    throw this.state.error;
  }
}
