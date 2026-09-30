/**
 * What the handlers need from the desktop they run on, and nothing about how.
 *
 * `main.ts` implements these with Electrobun (`Utils`, `BrowserWindow`, `Updater`). The handlers
 * are written against this port instead of importing Electrobun, for one reason that matters
 * here: Electrobun 2 ships its SDK through its own toolchain rather than npm, so a module that
 * imports it can be typechecked only where that toolchain has run (`task ci:desktop-check`).
 * Everything that can be written without it is, and the offline gate checks it.
 */

import type { InstallEvent } from "../rpc.ts";

export interface Question {
  readonly kind: "info" | "warning" | "error" | "question";
  readonly title: string;
  readonly message: string;
  readonly detail?: string;
  readonly buttons: readonly string[];
  /** The button Escape or closing the dialog answers. */
  readonly cancel: number;
}

export interface Shell {
  /** Open `url` in the person's browser. */
  openUrl: (url: string) => void;
  /** Open a folder in the file manager. */
  openFolder: (path: string) => void;
  chooseFolder: (start: string) => Promise<string | null>;
  /** The index of the button pressed. */
  ask: (question: Question) => Promise<number>;
  notify: (title: string, body: string) => void;
  /** Open the wizard's window, or bring it forward; it boots again from what is installed. */
  showWizard: () => void;
  closeWizard: () => void;
  /** Tell the wizard's window, if one is open, how an install is going. */
  progress: (event: InstallEvent) => void;
  quit: () => void;
}

export type UpdateCheck =
  | { readonly kind: "none" }
  | { readonly kind: "available"; readonly version: string }
  /** A development build, which never updates. */
  | { readonly kind: "dev" }
  | { readonly kind: "failed"; readonly error: string };

export interface Updates {
  check: () => Promise<UpdateCheck>;
  /**
   * Download the update and restart into it. Resolves only when that failed, with why; on
   * success the app has already quit into the new release.
   */
  apply: () => Promise<string | null>;
}
