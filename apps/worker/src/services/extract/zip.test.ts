/**
 * What reading a zip member as a stream promises: its text in pieces, and an end that says how
 * it ended -- never a short member passed off as a whole one. ADR 0106.
 *
 * Real archives from `zipOf`, no mocks; the ceiling is the one parameter a test may lower, since
 * no suite should inflate two gibibytes to see the default fire.
 */

import { describe, expect, test as it } from "bun:test";

import { zipOf } from "./testing.ts";
import { readZipIndex, type StreamEnd, streamZipText } from "./zip.ts";

/** Every piece a stream hands over, joined, and how it ended. */
async function drain(stream: AsyncGenerator<string, StreamEnd>): Promise<[string, StreamEnd]> {
  let text = "";
  for (;;) {
    const step = await stream.next();
    if (step.done === true) {
      return [text, step.value];
    }
    text += step.value;
  }
}

const SHEET = "<row/>".repeat(100_000);

describe("a member read as a stream", () => {
  it("is its whole text, in pieces, ending complete", async () => {
    const bytes = zipOf([{ name: "xl/worksheets/sheet1.xml", body: SHEET }]);

    expect(
      await drain(streamZipText(bytes, readZipIndex(bytes), "xl/worksheets/sheet1.xml")),
    ).toEqual([SHEET, "complete"]);
  });

  it("stops past its ceiling and says so, having handed over less than the member", async () => {
    // The ceiling bounds the work one part can demand -- a zip bomb is seconds of inflating,
    // not a run that never ends -- and a stopped member must not read as a shorter whole one.
    const bytes = zipOf([{ name: "xl/worksheets/sheet1.xml", body: SHEET }]);

    const [text, end] = await drain(
      streamZipText(bytes, readZipIndex(bytes), "xl/worksheets/sheet1.xml", 64 * 1024),
    );

    expect([text.length < SHEET.length, end]).toEqual([true, "too-large"]);
  });

  it("ends unreadable when its bytes are not the deflate stream the directory claims", async () => {
    const bytes = zipOf([{ name: "xl/worksheets/sheet1.xml", body: SHEET, corrupt: true }]);

    expect(
      (await drain(streamZipText(bytes, readZipIndex(bytes), "xl/worksheets/sheet1.xml")))[1],
    ).toBe("unreadable");
  });
});
