/**
 * The one promise `StatusLine` exists for: the region a screen reader listens to is in the
 * document BEFORE its sentence, and the sentence arrives in that same node.
 *
 * Broken, it fails without a sound. A region mounted together with its text renders exactly
 * the same words in exactly the same place, every visual check passes, and the person who
 * cannot see the page is simply never told that the copy, the save or the role change worked.
 *
 * No mocks: the real component, rendered and re-rendered as a press would.
 */

import { afterEach, expect, test as it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";

import { StatusLine } from "@/components/StatusLine.tsx";

afterEach(cleanup);

it("is listening before there is anything to say, and says it in the same region", () => {
  const { rerender } = render(<StatusLine className="note" text={null} />);
  const region = screen.getByRole("status");
  expect(region.textContent).toBe("");

  rerender(<StatusLine className="note" text="Copied." />);
  expect(screen.getByRole("status")).toBe(region);
  expect(region.textContent).toBe("Copied.");
  expect(region.className).toBe("note");
});
