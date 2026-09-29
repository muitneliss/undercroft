/**
 * Everything the blog says about itself, in one place: its address, the product it points
 * at, and the few words of chrome around the posts. The posts carry their own words; these
 * are the only strings a page writes, so they live here per locale rather than in place.
 */

export const SITE_URL = "https://blog.undercroft.lowbit.link";
export const PRODUCT_URL = "https://undercroft.lowbit.link";
export const REPO_URL = "https://github.com/muitneliss/undercroft";

export const LANGS = ["vi", "en"] as const;
export type Lang = (typeof LANGS)[number];

/** The sources Undercroft ingests today, each with one landing post per language. */
export const INTEGRATIONS = ["xero", "gmail", "google-drive", "hubspot"] as const;
export type Integration = (typeof INTEGRATIONS)[number];
export const INTEGRATION_NAMES: Record<Integration, string> = {
  xero: "Xero",
  gmail: "Gmail",
  "google-drive": "Google Drive",
  hubspot: "HubSpot",
};

/** The locale that owns the unprefixed paths and answers `x-default`. */
export const DEFAULT_LANG: Lang = "vi";

/** Path prefix of a locale: "" for the default, "/en" for English. */
export function langPrefix(lang: Lang): string {
  return lang === DEFAULT_LANG ? "" : `/${lang}`;
}

export const STRINGS = {
  vi: {
    ogLocale: "vi_VN",
    siteTitle: "Undercroft Blog — tích hợp Xero, Gmail, Google Drive và data integration",
    siteDescription:
      "Blog của Undercroft về data integration mã nguồn mở: tích hợp Xero, Gmail, Google Drive, HubSpot vào Postgres, ETL, ELT, raw data lake, dbt và BI.",
    integrations: "Integration",
    integrationsLead: "Kết nối nguồn dữ liệu của bạn vào một raw data lake và Postgres.",
    kicker: "Blog",
    skip: "Tới nội dung",
    headline: "Giữ nguyên dữ liệu gốc. Tự định nghĩa câu trả lời.",
    lead: "Những bài viết về cách xây một data platform: ETL, ELT, data integration, data lake, dbt và BI — viết từ chính mã nguồn của Undercroft.",
    latest: "Bài viết",
    readingTime: (minutes: number) => `${minutes} phút đọc`,
    published: "Đăng ngày",
    tags: "Chủ đề",
    related: "Đọc tiếp",
    otherLanguage: "Read in English",
    home: "Trang chủ blog",
    tryTitle: "Thử Undercroft",
    tryBody:
      "Undercroft là data platform mã nguồn mở (MIT): kết nối REST API, giữ raw data trong một lake bất biến, viết dbt model bằng SQL của bạn và xem báo cáo ngay trong sản phẩm.",
    tryProduct: "Mở Undercroft",
    tryRepo: "Mã nguồn trên GitHub",
    notFoundTitle: "Không tìm thấy trang",
    notFoundBody: "Trang này không tồn tại hoặc đã được chuyển đi.",
    rss: "RSS",
    footer: "Undercroft · mã nguồn mở theo giấy phép MIT",
    dateLocale: "vi-VN",
  },
  en: {
    ogLocale: "en_US",
    siteTitle: "Undercroft Blog — Xero, Gmail, Google Drive integration and ELT",
    siteDescription:
      "The Undercroft blog on open-source data integration: Xero, Gmail, Google Drive and HubSpot integration into Postgres, ETL vs ELT, raw data lakes, dbt and BI.",
    integrations: "Integrations",
    integrationsLead: "Connect your sources into one raw data lake and Postgres.",
    kicker: "Blog",
    skip: "Skip to content",
    headline: "Keep the original data. Define your own answers.",
    lead: "Writing on how a data platform is built: ETL, ELT, data integration, data lakes, dbt and BI — drawn from Undercroft's own source code.",
    latest: "Articles",
    readingTime: (minutes: number) => `${minutes} min read`,
    published: "Published",
    tags: "Topics",
    related: "Read next",
    otherLanguage: "Đọc bằng tiếng Việt",
    home: "Blog home",
    tryTitle: "Try Undercroft",
    tryBody:
      "Undercroft is an open-source (MIT) data platform: connect REST APIs, keep raw data in an immutable lake, write dbt models in your own SQL and read the reports inside the product.",
    tryProduct: "Open Undercroft",
    tryRepo: "Source on GitHub",
    notFoundTitle: "Page not found",
    notFoundBody: "This page does not exist or has moved.",
    rss: "RSS",
    footer: "Undercroft · open source under the MIT licence",
    dateLocale: "en-GB",
  },
} as const satisfies Record<Lang, Record<string, unknown>>;
