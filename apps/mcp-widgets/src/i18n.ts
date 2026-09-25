/**
 * What the widgets say, in Vietnamese first and English second (`.claude/rules/i18n.md`).
 *
 * The language is the HOST's: MCP Apps hands a widget its `hostContext.locale`, a BCP 47 tag,
 * and a tag that is neither of ours -- or none at all -- lands on Vietnamese, the product's
 * default, exactly as `negotiateLocale` answers a request. `vi` decides which keys exist and
 * `en` is typed to answer every one of them, so a sentence missing in either language is a
 * `tsc` error rather than a raw key on a customer's screen.
 *
 * A widget cannot use i18next: it is one self-contained page per widget, and a catalogue this
 * small does not earn a library. `{{name}}` interpolation is the only feature it needs.
 */

import { DEFAULT_LOCALE, type Locale, parseLocale } from "@undercroft/core/locale";

const vi = {
  loading: "Đang chờ kết quả…",
  empty: "Không có dòng nào.",
  refused: "Không có kết quả để hiển thị: {{message}}",
  shown:
    "Hiển thị {{shown}} trên {{total}} dòng. Toàn bộ kết quả nằm trong câu trả lời của công cụ.",
  more: "Máy chủ còn nhiều dòng hơn số đã trả về. Hãy hỏi trang tiếp theo.",
  yes: "có",
  no: "không",
  colKind: "loại",
  colSource: "nguồn",
  colEntity: "thực thể",
  colRecord: "bản ghi",
  colDocument: "tài liệu",
  colExcerpt: "trích đoạn",
  colObservedAt: "ghi nhận lúc",
  colDeletedAt: "bị xoá lúc",
  colPayload: "dữ liệu",
  colContentType: "định dạng",
  colBytes: "byte",
  colLoadedAt: "nạp lúc",
  runHead: "Lượt chạy {{runId}}",
  runRunning: "Đang chạy",
  runOk: "Hoàn tất",
  runFailed: "Thất bại",
  runLanded: "{{landed}} bản ghi về, {{refused}} bị từ chối",
  runStarted: "Bắt đầu {{at}}",
  runEnded: "Kết thúc {{at}}",
  runEvents: "Diễn biến gần nhất",
  runNoEvents: "Chưa có diễn biến nào.",
  runStoppedHidden: "Đã tạm dừng theo dõi vì khung đang bị ẩn.",
  runStoppedLong: "Đã ngừng theo dõi sau 30 phút. Hỏi lại trạng thái lượt chạy để xem tiếp.",
  runUnreadable: "Không đọc được trạng thái lượt chạy: {{message}}",
  runUnknown: "Kết quả này không cho biết lượt chạy nào.",
} as const;

type Key = keyof typeof vi;

const en: Readonly<Record<Key, string>> = {
  loading: "Waiting for the result…",
  empty: "No rows.",
  refused: "There is nothing to show: {{message}}",
  shown: "Showing {{shown}} of {{total}} rows. The whole result is in the tool's answer.",
  more: "The server has more rows than it returned. Ask for the next page.",
  yes: "yes",
  no: "no",
  colKind: "kind",
  colSource: "source",
  colEntity: "entity",
  colRecord: "record",
  colDocument: "document",
  colExcerpt: "excerpt",
  colObservedAt: "observed at",
  colDeletedAt: "deleted at",
  colPayload: "payload",
  colContentType: "content type",
  colBytes: "bytes",
  colLoadedAt: "loaded at",
  runHead: "Run {{runId}}",
  runRunning: "Running",
  runOk: "Finished",
  runFailed: "Failed",
  runLanded: "{{landed}} records landed, {{refused}} refused",
  runStarted: "Started {{at}}",
  runEnded: "Ended {{at}}",
  runEvents: "Latest events",
  runNoEvents: "No events yet.",
  runStoppedHidden: "Stopped following while this frame is hidden.",
  runStoppedLong: "Stopped following after 30 minutes. Ask for the run's status to see more.",
  runUnreadable: "The run's status could not be read: {{message}}",
  runUnknown: "This result does not say which run it is.",
};

const CATALOGUES: Readonly<Record<Locale, Readonly<Record<Key, string>>>> = { vi, en };

const PLACEHOLDER = /\{\{(?<name>\w+)\}\}/gu;

/** A sentence in one language, with its `{{name}}` slots filled. */
export type Words = (key: Key, values?: Readonly<Record<string, string>>) => string;

export function wordsFor(locale: Locale): Words {
  const catalogue = CATALOGUES[locale];
  return (key, values = {}) =>
    catalogue[key].replace(PLACEHOLDER, (slot, name: string) => values[name] ?? slot);
}

/** The host's language as one of ours, Vietnamese when it is not one of ours. */
export function localeOf(hostLocale: string | undefined): Locale {
  return parseLocale(hostLocale) ?? DEFAULT_LOCALE;
}
