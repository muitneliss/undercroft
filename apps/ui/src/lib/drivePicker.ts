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

// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: Every one of these is a boundary where a payload genuinely is unknown -- a third-party API body, a Docker inspect response, a row shape from a hand-written query -- and is Zod-parsed or checked immediately after. Making the assertions safe means modelling each external shape as a type, which is real work with real value and is not a lint migration.
// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as useExplicitType above: what remains are contextually-typed callbacks and factories whose inferred type is a tRPC router shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- Better Auth's hooks, tRPC's builders -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useExportsLast: Reordering 28 modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. The ordering carries meaning here and the rule's preferred one does not.
// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

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
