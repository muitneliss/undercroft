/**
 * What a person has told the platform about themselves. One thing so far: their language.
 *
 * The browser's store owns the choice while a page is open (`apps/ui/src/store.ts`), and it
 * is projected here so an email written while no page is open -- a failed run at three in
 * the morning -- arrives in the language its reader chose rather than the one the platform
 * defaults to. Recorded at first sign-in from the request's `Accept-Language`, and again
 * whenever the reader changes it.
 */

import type { Locale } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";

import { setLocale as writeLocale } from "../repos/appUser.ts";

export function setLocale(exec: SqlExecutor, userId: string, locale: Locale): Promise<void> {
  return writeLocale(exec, userId, locale);
}
