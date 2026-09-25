/**
 * A new printing is out: the notice that this tab is running a release the server has
 * replaced, with the one action that fixes it.
 *
 * Shown on every screen, the title page included, because a tab left open across a deploy
 * is on whichever screen it was left on. It is a slip laid on top of the page rather than a
 * band pushing the page down, so the leaf under it does not move while somebody is reading
 * it, and it is `role="status"` rather than an alert: nothing is wrong yet, and the reader
 * may finish what they are doing first. Reloading is theirs to press -- a tab that reloaded
 * itself would throw away a half-written model or question without asking.
 *
 * The tag is printed verbatim, as in the colophon, so the reader can see what they will be
 * on after pressing it. `@/lib/releaseWatch` decides when there is one; this only renders it.
 */

import { useTranslation } from "react-i18next";

import { useUiStore } from "@/store.ts";

function reload(): void {
  globalThis.location.reload();
}

export function ReleaseNotice(): React.JSX.Element | null {
  const { t } = useTranslation();
  const liveRelease = useUiStore((state) => state.liveRelease);

  if (liveRelease === null) {
    return null;
  }

  return (
    <aside className="release-notice" role="status">
      <p className="note">{t("app.releaseLive", { release: liveRelease })}</p>
      <button type="button" className="plate" onClick={reload}>
        {t("app.reload")}
      </button>
    </aside>
  );
}
