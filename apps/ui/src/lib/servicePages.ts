/**
 * The blog's front page, and the hosted service's own public pages -- what the app is, its
 * privacy policy, its terms -- which live on the blog (`apps/blog/src/content/service`), not in this app.
 *
 * Google's brand verification reads the home page signed out and requires it to link the
 * privacy policy and terms; the SPA cannot hold them itself, because a reviewer must read them
 * without JavaScript and without signing in. Each page exists in both languages at the same
 * name, Vietnamese unprefixed and English under `/en/`, exactly as `servicePath` in
 * `apps/blog/src/site.ts` builds them, so the reader lands in the language they chose here.
 */
import type { Locale } from "@undercroft/core/locale";

const BLOG_URL = "https://blog.undercroft.lowbit.link";

export type ServicePage = "app" | "privacy" | "terms";

/** The blog's index in the reader's language, as `langPrefix` in `apps/blog/src/site.ts` builds it. */
export function blogUrl(locale: Locale): string {
  const prefix = locale === "vi" ? "" : `/${locale}`;
  return `${BLOG_URL}${prefix}/`;
}

export function servicePageUrl(locale: Locale, page: ServicePage): string {
  return `${blogUrl(locale)}${page}/`;
}
