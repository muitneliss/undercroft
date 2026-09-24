/**
 * What a Drive scope is chosen from, as the browse answers it (issue 177, ADR 0047).
 *
 * Two promises, and both fail silently. A folder without its path is one of two "2026" folders
 * an admin cannot tell apart, and pasting the wrong one into a scope reads the wrong books. A
 * type list cut at its bound and presented whole tells an admin "these are the only types in
 * your drive" on no evidence, and they narrow `fileTypes` on the strength of it.
 *
 * A byte fetcher that REFUSES an unmodelled request, so a listing that asked Drive anything
 * nobody recorded fails loudly here rather than reading as an empty drive.
 */

import { createPacer, InMemoryByteFetcher, TestClock } from "@undercroft/core";
import { beforeEach, expect, test as it } from "bun:test";

import { createGoogleApi } from "./api.ts";
import { type DriveBrowseBounds, listDriveChoices, SHARED_DRIVES_URL } from "./driveChoices.ts";

const FILES = "https://www.googleapis.com/drive/v3/files";
const FOLDER = "application/vnd.google-apps.folder";

let fetcher: InMemoryByteFetcher;

beforeEach(() => {
  fetcher = new InMemoryByteFetcher();
});

function choices(bounds?: DriveBrowseBounds): ReturnType<typeof listDriveChoices> {
  const clock = new TestClock();
  const api = createGoogleApi("drive", {
    fetcher,
    token: () => Promise.resolve("tok"),
    clock,
    // No minimum interval: on a TestClock nothing advances, so a pacer that sleeps between
    // requests never wakes. Pacing is exercised against the clock it needs in `api.test.ts`.
    pacer: createPacer({}, clock),
  });
  return bounds === undefined ? listDriveChoices(api) : listDriveChoices(api, bounds);
}

/** The listing the browse sends, spelled as a test must spell it: every drive, every page. */
function filesUrl(q: string, files: string, pageToken?: string): string {
  const url = new URL(FILES);
  url.searchParams.set("q", q);
  url.searchParams.set("fields", `nextPageToken,incompleteSearch,${files}`);
  url.searchParams.set("pageSize", "1000");
  url.searchParams.set("corpora", "allDrives");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  if (pageToken !== undefined) {
    url.searchParams.set("pageToken", pageToken);
  }
  return url.toString();
}

const FOLDERS_Q = `mimeType = '${FOLDER}' and trashed = false`;
const TYPES_Q = `mimeType != '${FOLDER}' and trashed = false`;
const DRIVES = `${SHARED_DRIVES_URL}?pageSize=100&fields=nextPageToken%2Cdrives%28id%2Cname%29`;

it("lists every folder with its path, a shared drive's name first, and every type present", async () => {
  fetcher
    .on("GET", DRIVES, { body: { drives: [{ id: "sd-1", name: "Finance team" }] } })
    .on("GET", filesUrl(FOLDERS_Q, "files(id,name,parents)"), {
      body: {
        files: [
          // Deliberately out of order, and two folders of one name in two places.
          { id: "f-2026b", name: "2026", parents: ["f-audit"] },
          { id: "f-audit", name: "Audit", parents: ["sd-1"] },
          { id: "f-2026a", name: "2026", parents: ["f-books"] },
          // Its parent is My Drive's root, which no folder listing returns.
          { id: "f-books", name: "Books", parents: ["root-id"] },
        ],
      },
    })
    .on("GET", filesUrl(TYPES_Q, "files(mimeType)"), {
      body: {
        files: [
          { mimeType: "application/pdf" },
          { mimeType: "image/heic" },
          { mimeType: "application/pdf" },
        ],
      },
    });

  expect(await choices()).toEqual({
    items: [
      { id: "f-books", name: "Books", kind: "folder", path: ["Books"] },
      { id: "f-2026a", name: "2026", kind: "folder", path: ["Books", "2026"] },
      { id: "f-audit", name: "Audit", kind: "folder", path: ["Finance team", "Audit"] },
      { id: "f-2026b", name: "2026", kind: "folder", path: ["Finance team", "Audit", "2026"] },
      { id: "application/pdf", name: "application/pdf", kind: "file-type" },
      { id: "image/heic", name: "image/heic", kind: "file-type" },
    ],
    // Every listing reached its last page, so nothing is claimed partial.
    partial: [],
  });
});

it("a listing that stops at its bound, or that Google calls incomplete, says which list is partial", async () => {
  // The firing side. One page of folders is allowed and Drive has a second; the type search
  // finished its pages but Google reports it did not search everything, which
  // `corpora=allDrives` is allowed to do. Neither list may be presented as the whole.
  fetcher
    .on("GET", DRIVES, { body: { drives: [] } })
    .on("GET", filesUrl(FOLDERS_Q, "files(id,name,parents)"), {
      body: { nextPageToken: "page-2", files: [{ id: "f-1", name: "Books", parents: ["r"] }] },
    })
    .on("GET", filesUrl(TYPES_Q, "files(mimeType)"), {
      body: { incompleteSearch: true, files: [{ mimeType: "application/pdf" }] },
    });

  const answer = await choices({ sharedDrivePages: 1, folderPages: 1, typePages: 1 });

  expect(answer.partial).toEqual(["folder", "file-type"]);
  // What was read is still offered: partial is not empty.
  expect(answer.items.map((item) => item.id)).toEqual(["f-1", "application/pdf"]);
  // And the bound held: the second page of folders was never asked for.
  expect(fetcher.calls.map((call) => call.url)).not.toContain(
    filesUrl(FOLDERS_Q, "files(id,name,parents)", "page-2"),
  );
});
