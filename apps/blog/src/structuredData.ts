/**
 * schema.org JSON-LD, built from the same facts the page renders so the two cannot disagree.
 * The publisher is the product, not a person: every post speaks for Undercroft.
 */
import { PRODUCT_URL, REPO_URL } from "./site.ts";

/** A schema.org node; its shape is schema.org's, not ours to type field by field. */
export type JsonLd = Record<string, unknown>;

export function organization(logoUrl: string): JsonLd {
  return {
    "@type": "Organization",
    name: "Undercroft",
    url: PRODUCT_URL,
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
