/**
 * Google's file Picker, which is the only way `drive.file` can be scoped.
 *
 * Under `drive.file` a credential reaches exactly what the user picked through this dialog
 * and nothing else -- Google enforces it, which is what makes the card's promise "No other
 * folder is read" true rather than merely intended. There is no server-side alternative: a
 * folder listing would need `drive.readonly`, which is a Google *restricted* scope and would
 * pull the whole product into an annual CASA security assessment.
 *
 * TWO TOKENS, AND THEY ARE NOT THE SAME TOKEN. The Picker needs a short-lived access token
 * in the browser, obtained here through Google Identity Services. The credential the worker
 * seals comes from the separate server-side code flow. They share a client id, which is what
 * makes a file picked in this dialog readable by the server later -- `drive.file` grants
 * per (app, file), not per token. The browser's token is never sent to us and never stored.
 *
 * Both Google scripts are loaded on demand rather than in `index.html`: an operator who never
 * connects Drive should not be fetching Google's JavaScript on every page.
 */

import type { ChosenFile } from "@/store.ts";

const GSI_SRC = "https://accounts.google.com/gsi/client";
const GAPI_SRC = "https://apis.google.com/js/api.js";
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const PDF_MIME = "application/pdf";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export interface GooglePickerConfig {
  readonly clientId: string;
  readonly apiKey: string;
  readonly appId: string;
}

/** The slices of Google's globals this module uses. Narrow on purpose. */
interface GoogleGlobals {
  accounts?: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        callback: (response: { access_token?: string }) => void;
      }) => { requestAccessToken: () => void };
    };
  };
  picker?: unknown;
}

// biome-ignore-start lint/nursery/useVarsOnTop: `var` is the only declaration form that adds to `globalThis` in an ambient block. There is no hoisting here to regret -- these are type declarations for two scripts Google injects.
declare global {
  var google: GoogleGlobals | undefined;
  var gapi: { load: (name: string, cb: () => void) => void } | undefined;
}
// biome-ignore-end lint/nursery/useVarsOnTop: see above

function loadScript(src: string): Promise<void> {
  if (document.querySelector(`script[src="${src}"]`) !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      resolve();
    };
    script.onerror = () => {
      reject(new Error(`could not load ${src}`));
    };
    document.head.append(script);
  });
}

/**
 * Open the Picker and report what was chosen.
 *
 * Resolves when the dialog closes. A cancelled pick calls back with nothing rather than
 * raising -- cancelling is a decision, not a fault.
 */
export async function openDrivePicker(
  config: GooglePickerConfig,
  onPicked: (files: ChosenFile[]) => void,
): Promise<void> {
  await Promise.all([loadScript(GSI_SRC), loadScript(GAPI_SRC)]);

  const accessToken = await requestBrowserToken(config.clientId);
  if (accessToken === null) {
    return;
  }

  await new Promise<void>((resolve) => {
    globalThis.gapi?.load("picker", () => {
      resolve();
    });
  });

  // `google.picker` is typed as `unknown` above deliberately: the Picker's builder API is
  // large, vendor-owned and changes without our say-so. Reaching into it through one narrow
  // cast at one call site is more honest than a hand-written declaration file claiming to
  // describe it.
  const picker = globalThis.google?.picker as PickerNamespace | undefined;
  if (picker === undefined) {
    return;
  }

  const view = new picker.DocsView(picker.ViewId.DOCS)
    .setIncludeFolders(true)
    .setSelectFolderEnabled(true)
    .setMimeTypes(`${PDF_MIME},${FOLDER_MIME}`);

  new picker.PickerBuilder()
    .setOAuthToken(accessToken)
    .setDeveloperKey(config.apiKey)
    .setAppId(config.appId)
    .addView(view)
    .enableFeature(picker.Feature.MULTISELECT_ENABLED)
    .setCallback((data: PickerResponse) => {
      if (data.action !== picker.Action.PICKED) {
        return;
      }
      onPicked(
        (data.docs ?? []).map((doc) => ({
          id: doc.id,
          name: doc.name,
          kind: doc.mimeType === FOLDER_MIME ? "folder" : "file",
        })),
      );
    })
    .build()
    .setVisible(true);
}

/** A short-lived browser token for the Picker alone. Never sent to us, never stored. */
function requestBrowserToken(clientId: string): Promise<string | null> {
  const oauth2 = globalThis.google?.accounts?.oauth2;
  if (oauth2 === undefined) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    oauth2
      .initTokenClient({
        client_id: clientId,
        scope: DRIVE_FILE_SCOPE,
        callback: (response) => {
          resolve(response.access_token ?? null);
        },
      })
      .requestAccessToken();
  });
}

interface PickerResponse {
  action: string;
  docs?: { id: string; name: string; mimeType: string }[];
}

interface PickerView {
  setIncludeFolders: (on: boolean) => PickerView;
  setSelectFolderEnabled: (on: boolean) => PickerView;
  setMimeTypes: (types: string) => PickerView;
}

interface PickerBuilderApi {
  setOAuthToken: (token: string) => PickerBuilderApi;
  setDeveloperKey: (key: string) => PickerBuilderApi;
  setAppId: (appId: string) => PickerBuilderApi;
  addView: (view: PickerView) => PickerBuilderApi;
  enableFeature: (feature: unknown) => PickerBuilderApi;
  setCallback: (cb: (data: PickerResponse) => void) => PickerBuilderApi;
  build: () => { setVisible: (visible: boolean) => void };
}

interface PickerNamespace {
  DocsView: new (viewId: unknown) => PickerView;
  PickerBuilder: new () => PickerBuilderApi;
  ViewId: { DOCS: unknown };
  Feature: { MULTISELECT_ENABLED: unknown };
  Action: { PICKED: string };
}
