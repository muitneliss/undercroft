import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "bun:test";
import { asMoney, Money } from "./Money.tsx";

describe("Money renders an amount without lying about it", () => {
  test("truncates rather than rounding, and keeps the exact value in the title", () => {
    // The plan's checkpoint: 8500.0001 shows as 8,500.00, and the exact stored value is
    // recoverable from the title -- the display trims, it does not round up.
    render(<Money value={asMoney("8500.0001", "SGD")} />);
    const el = screen.getByTestId("money");
    expect(el.textContent).toContain("8,500.00");
    expect(el.getAttribute("title")).toBe("8500.0001 SGD");
  });

  test("a missing amount renders as an em dash, never as zero", () => {
    render(<Money value={null} />);
    const el = screen.getByTestId("money");
    expect(el.textContent).toBe("—");
    expect(el.textContent).not.toBe("0.00");
  });

  test("shows the currency alongside the amount", () => {
    render(<Money value={asMoney("1234.5", "USD")} />);
    expect(screen.getByTestId("money").textContent).toContain("USD");
  });
});
