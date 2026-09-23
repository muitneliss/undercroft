import { describe, expect, test as it } from "bun:test";

import { type EmailLeaf, renderEmailLeaf } from "./emailTemplate.ts";

function leaf(overrides: Partial<EmailLeaf> = {}): EmailLeaf {
  return {
    locale: "en",
    subject: "A subject",
    runningHead: "CASE-0042",
    heading: "A heading",
    lead: "A lead sentence.",
    blocks: [],
    colophon: "Undercroft sent this automatically.",
    ...overrides,
  };
}

describe("renderEmailLeaf", () => {
  it("carries the subject through untouched", () => {
    // A subject is a mail header, not HTML: an escaper applied here would put `&amp;` in
    // the reader's inbox.
    const subject = 'Invoice <7> & "co"';
    expect(renderEmailLeaf(leaf({ subject })).subject).toBe(subject);
  });

  it("writes the leaf's own locale onto <html lang>", () => {
    expect(renderEmailLeaf(leaf({ locale: "vi" })).html).toContain('<html lang="vi"');
    expect(renderEmailLeaf(leaf({ locale: "en" })).html).toContain('<html lang="en"');
  });

  it("the text alternative carries no markup", () => {
    const { text } = renderEmailLeaf(
      leaf({
        blocks: [
          { kind: "prose", text: "A sentence." },
          { kind: "schedule", rows: [{ label: "Source", value: "HubSpot" }] },
          { kind: "token", value: "418302" },
          { kind: "errata", mark: "Erratum", text: "connection refused" },
          { kind: "plate", label: "Sign in", href: "https://example.test/x" },
          { kind: "note", text: "A note." },
        ],
      }),
    );

    expect(text).not.toContain("<");
    expect(text).not.toContain("&amp;");
  });

  it("every word in the text is in the html, and the reverse", () => {
    const rendered = renderEmailLeaf(
      leaf({
        heading: "The HubSpot sync failed",
        lead: "A lead sentence.",
        blocks: [
          { kind: "prose", text: "Salient prose." },
          { kind: "schedule", rows: [{ label: "Source", value: "HubSpot" }] },
          { kind: "errata", mark: "Erratum", text: "connection refused" },
          { kind: "plate", label: "See the journal", href: "https://example.test/j" },
          { kind: "note", text: "A closing note." },
        ],
      }),
    );

    for (const phrase of [
      "The HubSpot sync failed",
      "A lead sentence.",
      "Salient prose.",
      // A label, a mark and a plate are set in caps by the renderer rather than by
      // `text-transform`, so both branches carry these characters identically.
      "SOURCE",
      "HubSpot",
      "ERRATUM",
      "connection refused",
      "SEE THE JOURNAL",
      "https://example.test/j",
      "A closing note.",
      "Undercroft sent this automatically.",
      "CASE-0042",
    ]) {
      expect(rendered.text).toContain(phrase);
      expect(rendered.html).toContain(phrase);
    }
  });
});

/**
 * The escaping guard, pinned from both sides. A key's label and a run's error message are
 * written by somebody outside this repo and land in an administrator's inbox; before this
 * template there was no markup for them to break out of.
 */
describe("hostile values", () => {
  const hostile = '<script>alert("x")</script> & co';

  it("markup in a value cannot reach the html as markup", () => {
    const { html } = renderEmailLeaf(
      leaf({
        heading: hostile,
        blocks: [
          { kind: "prose", text: hostile },
          { kind: "schedule", rows: [{ label: hostile, value: hostile }] },
          { kind: "errata", mark: hostile, text: hostile },
          { kind: "plate", label: hostile, href: `https://example.test/?q=${hostile}` },
          { kind: "note", text: hostile },
        ],
      }),
    );

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp; co");
  });

  it("a quote in a value cannot close the attribute it sits in", () => {
    const { html } = renderEmailLeaf(
      leaf({ blocks: [{ kind: "plate", label: "Go", href: 'https://example.test/" onclick="x' }] }),
    );

    expect(html).not.toContain('onclick="x');
    expect(html).toContain("&quot;");
  });

  it("an ordinary value is left readable", () => {
    const { html, text } = renderEmailLeaf(
      leaf({
        heading: "The Gmail sync for CASE-0042 failed",
        blocks: [{ kind: "schedule", rows: [{ label: "Key", value: "nightly-load" }] }],
      }),
    );

    expect(html).toContain("The Gmail sync for CASE-0042 failed");
    expect(html).not.toContain("&#");
    expect(text).toContain("nightly-load");
  });
});

/**
 * `.claude/rules/money.md`'s absence rule, which the design system states as its own: a
 * value the system does not have renders as an em dash, never as a zero and never as a
 * blank cell that reads as "nothing was wrong".
 */
describe("a missing value", () => {
  it("renders as an em dash in both branches", () => {
    const { html, text } = renderEmailLeaf(
      leaf({ blocks: [{ kind: "schedule", rows: [{ label: "Reason", value: null }] }] }),
    );

    expect(text).toContain("—");
    expect(html).toContain("—");
    expect(text).not.toContain("null");
    expect(html).not.toContain("null");
  });

  it("a value that is present is not replaced by one", () => {
    const { html, text } = renderEmailLeaf(
      leaf({ blocks: [{ kind: "schedule", rows: [{ label: "Reason", value: "timed out" }] }] }),
    );

    expect(text).toContain("timed out");
    expect(html).toContain("timed out");
    expect(text).not.toContain("—");
  });
});

/**
 * The Vermilion Rule, from `apps/ui/DESIGN.md`: vermilion is held out of the wheel so that
 * the errata slip is the only object wearing it. A template that put it on every notice
 * would spend the one colour the system reserves for a correction.
 */
describe("the vermilion rule", () => {
  const VERMILION = "#cf2f16";

  it("an errata block wears vermilion", () => {
    const { html } = renderEmailLeaf(
      leaf({ blocks: [{ kind: "errata", mark: "Erratum", text: "it failed" }] }),
    );

    expect(html).toContain(VERMILION);
  });

  it("a leaf with no errata wears none", () => {
    const { html } = renderEmailLeaf(
      leaf({
        blocks: [
          { kind: "prose", text: "All is well." },
          { kind: "schedule", rows: [{ label: "Expires", value: "01 Oct", tone: "pending" }] },
          { kind: "plate", label: "Reconnect", href: "https://example.test/" },
        ],
      }),
    );

    expect(html).not.toContain(VERMILION);
    expect(html).not.toContain("#8c1c09");
  });
});

/**
 * Nothing in these messages calls home. A remote font, a spacer image or a tracking pixel
 * would tell a third party that a sign-in code had been opened, from which IP, and when --
 * which is a worse thing to ship than an unstyled email.
 */
describe("self-containment", () => {
  it("the html requests nothing from the network", () => {
    const { html } = renderEmailLeaf(
      leaf({
        blocks: [
          { kind: "token", value: "418302" },
          { kind: "plate", label: "Sign in", href: "https://example.test/" },
        ],
      }),
    );

    expect(html).not.toContain("<img");
    expect(html).not.toContain("<link");
    expect(html).not.toContain("@import");
    expect(html).not.toContain("url(");
    expect(html).not.toContain("background-image");
  });

  it("sets the mark before the wordmark, drawn into the markup and silent to a reader", () => {
    // The tests either side are its quiet half: the leaves they render carry the mark too,
    // and neither finds a fetch or a URL it was not given.
    const { html } = renderEmailLeaf(leaf());

    expect(html).toMatch(/<svg [^>]*aria-hidden="true"[^>]*><path d="[^"]+"\/><\/svg>UNDERCROFT/u);
  });

  it("the only absolute URLs are the ones the leaf was given", () => {
    const { html } = renderEmailLeaf(
      leaf({ blocks: [{ kind: "plate", label: "Sign in", href: "https://example.test/go" }] }),
    );

    expect(html.match(/https?:\/\//gu)).toEqual(["https://"]);
  });
});

/**
 * The leaf has to fit a phone. It did not, once: a fixed `width="560"` renders identically
 * to a fluid one on a desktop and clips on every handset, so nothing about the desktop
 * preview says which of the two you shipped.
 */
describe("the measure", () => {
  it("is capped rather than fixed, so a narrow client can shrink it", () => {
    const { html } = renderEmailLeaf(leaf());

    expect(html).toContain("max-width:560px");
    // Anchored to a declaration boundary: `max-width:560px` contains `width:560px` as a
    // substring, so a bare `toContain` here passes whichever of the two shipped.
    expect(html).not.toMatch(/[;"]width:560px/u);
  });

  it("still gives Outlook the 560px it cannot get from a max-width", () => {
    // The quiet side: the Word engine ignores `max-width`, so removing the fixed width
    // without leaving it this conditional would widen the leaf to the whole window there.
    const { html } = renderEmailLeaf(leaf());

    expect(html).toContain("<!--[if mso]>");
    expect(html).toContain('width="560"');
  });
});

describe("blocks", () => {
  it("a token is set on its own, away from the prose", () => {
    const { html, text } = renderEmailLeaf(leaf({ blocks: [{ kind: "token", value: "418302" }] }));

    expect(text).toContain("418302");
    // Letter-spacing on a centred figure needs the matching indent, or the digits sit left
    // of centre by exactly the trailing space the last one carries.
    expect(html).toContain("text-indent");
    expect(html).toContain("418302");
  });

  it("a plate is a link a mail client will draw as a control", () => {
    const { html } = renderEmailLeaf(
      leaf({ blocks: [{ kind: "plate", label: "Sign in", href: "https://example.test/" }] }),
    );

    expect(html).toContain('href="https://example.test/"');
    expect(html).toContain("#eda600");
  });

  it("a running head is optional and leaves no empty separator behind", () => {
    // Built without the key rather than with it set to undefined: `exactOptionalPropertyTypes`
    // is on, and an absent property is what a sign-in code actually passes.
    const { text } = renderEmailLeaf({
      locale: "en",
      subject: "A subject",
      heading: "A heading",
      blocks: [],
      colophon: "Undercroft sent this automatically.",
    });

    expect(text).toContain("UNDERCROFT");
    expect(text).not.toContain("·");
  });
});
