/**
 * schema.org JSON-LD, built from the same facts the page renders so the two cannot disagree.
 * The publisher is the product, not a person: every post speaks for Undercroft.
 */
import { CONTACT_EMAIL, PRODUCT_URL, REPO_URL } from "./site.ts";

/** A schema.org node; its shape is schema.org's, not ours to type field by field. */
export type JsonLd = Record<string, unknown>;

/**
 * A node as the text of its `<script type="application/ld+json">`, which the page writes raw
 * (`set:html`): a script's body is not HTML, so escaping it as HTML would corrupt the JSON.
 *
 * Every `<` is written `<`. `JSON.stringify` leaves it bare, and these nodes carry a post's
 * own title and description: a post about markup with `</script>` in its title would close the
 * element mid-string and turn the rest of the JSON into the page. `<` is the same
 * character to every JSON parser, so what a search engine reads is unchanged.
 */
export function jsonLdText(node: JsonLd): string {
  return JSON.stringify(node).replaceAll("<", "\\u003c");
}

export function organization(logoUrl: string): JsonLd {
  return {
    "@type": "Organization",
    name: "Undercroft",
    url: PRODUCT_URL,
    email: CONTACT_EMAIL,
    logo: { "@type": "ImageObject", url: logoUrl },
    sameAs: [REPO_URL],
  };
}

export function softwareApplication(description: string): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Undercroft",
    description,
    url: PRODUCT_URL,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Linux (Docker)",
    license: "https://opensource.org/license/mit",
    codeRepository: REPO_URL,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
}

export function breadcrumbs(items: { name: string; url: string }[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}
