/**
 * Which files a scope's file types let through, and what they are filed under. The MIME type
 * is asked first; a name is consulted only when the type says nothing.
 */

import { describe, expect, test as it } from "bun:test";

import { allowsFile, extensionOf, landedType } from "./index.ts";

const OCTET = "application/octet-stream";

describe("allowsFile", () => {
  it("an empty allow-list matches any file", () => {
    expect(allowsFile([], { mimeType: "image/png", name: "logo.png" })).toBe(true);
    expect(allowsFile([], { mimeType: OCTET, name: "archive.bin" })).toBe(true);
  });

  it("a non-empty allow-list matches only the types it names", () => {
    expect(allowsFile(["application/pdf"], { mimeType: "application/pdf", name: "a.pdf" })).toBe(
      true,
    );
    expect(allowsFile(["application/pdf"], { mimeType: "image/png", name: "a.png" })).toBe(false);
  });

  it("a PDF whose name ends 'for Mr. Smith' is matched by its MIME type", () => {
    // The issue's regression: cutting at the last dot called this file a `smith`, and eight
    // service contracts were filed as something they were not.
    const file = { mimeType: "application/pdf", name: "Services Agreement for Mr. Smith" };
    expect(allowsFile(["application/pdf"], file)).toBe(true);
  });

  it("a .oa sent as octet-stream is matched by the .oa choice and filed as JSON", () => {
    const file = { mimeType: OCTET, name: "Business Profile.oa" };
    expect(allowsFile([".oa"], file)).toBe(true);
    expect(landedType(file)).toBe("application/json");
  });

  it("an extension never overrides a MIME type that says what the file is", () => {
    const file = { mimeType: "application/pdf", name: "renamed.oa" };
    expect(allowsFile([".oa"], file)).toBe(false);
    expect(landedType(file)).toBe("application/pdf");
  });

  it("an octet-stream file is not matched by a MIME choice, whatever its name", () => {
    // Choosing PDF lands the files Drive calls PDFs, exactly as before extensions existed.
    expect(allowsFile(["application/pdf"], { mimeType: OCTET, name: "scan.pdf" })).toBe(false);
  });

  it("an octet-stream type chosen as itself matches every such file, whatever its name", () => {
    // The Drive browse offers each MIME type present, octet-stream included; choosing it is
    // a decision about the type, and the extension rule must not narrow it.
    expect(allowsFile([OCTET], { mimeType: OCTET, name: "Acme Pte. Ltd." })).toBe(true);
  });

  it("a chosen format matches every spelling a provider sends for it", () => {
    expect(allowsFile(["application/xml"], { mimeType: "text/xml", name: "fs.xbrl" })).toBe(true);
    expect(
      allowsFile(["application/vnd.ms-excel.sheet.macroenabled.12"], {
        mimeType: "application/vnd.ms-excel.sheet.macroEnabled.12",
        name: "book.xlsm",
      }),
    ).toBe(true);
  });
});

describe("extensionOf", () => {
  it("reads a short run of letters and digits after the last dot", () => {
    expect(extensionOf("Business Profile.OA")).toBe("oa");
    expect(extensionOf("report.xlsx")).toBe("xlsx");
  });

  it("finds none in a name whose last dot is not an extension", () => {
    // Every one of these was measured misread as an extension in a real Drive.
    expect(extensionOf("Services Agreement for Mr. Smith")).toBeNull();
    expect(extensionOf("Tax Queries Rev.1")).toBeNull();
    expect(extensionOf("Acme Holdings Pte. Ltd.")).toBeNull();
    expect(extensionOf("SALES & PURCHASE CONTRACT , 01.01/2024 QT-FXpdf")).toBeNull();
    expect(extensionOf("no extension at all")).toBeNull();
  });
});
