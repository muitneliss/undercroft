// biome-ignore-all lint/performance/noBarrelFile: `index.ts` is each package's public entry point, which is the seam `.claude/rules/layering.md` is built on and what `.claude/rules/tests.md` means by testing through the public API. The re-export cost the rule is about applies to a bundle; these are workspace packages consumed by name.

export { canonicalJson, canonicalJsonFromText, parseLossless } from "./canonicalJson.ts";
export { type Clock, systemClock, TestClock } from "./clock.ts";
export {
  createHttpEmailSender,
  DEFAULT_EMAIL_ENDPOINT,
  type EmailMessage,
  type EmailSender,
  type HttpEmailSenderOptions,
  InMemoryEmailSender,
  UnsendableEmail,
} from "./email.ts";
export { ConnectorError, HttpError, QuotaExhausted, UndercroftError } from "./errors.ts";
export { getPath, getStringPath, parsePath } from "./getPath.ts";
export { newRequestId, newRunId } from "./ids.ts";
export { DEFAULT_LOCALE, LOCALES, type Locale, negotiateLocale, parseLocale } from "./locale.ts";
export {
  createLogger,
  describeError,
  type LogFields,
  type Logger,
  type LoggerOptions,
  type LogLevel,
} from "./log.ts";
export {
  type Amount,
  add,
  compare,
  currency,
  formatMoney,
  type Iso4217,
  isIso4217,
  MISSING,
  type Money,
  money,
  parseAmount,
  SCALE_DP,
  sub,
  toBig,
  type Verdict,
} from "./money.ts";
export { createPacer, type Pacer, type PacerOptions } from "./pacer.ts";
export {
  DEFAULT_RETRY,
  parseRetryAfter,
  type RetryDeps,
  type RetryPolicy,
  withRetry,
} from "./retry.ts";
export { createStampSource, formatStamp, isStamp, parseStamp, type StampSource } from "./stamp.ts";
