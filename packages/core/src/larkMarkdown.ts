/**
 * Text as a Lark card (JSON 1.0) renders it: GitHub-flavoured markdown translated into the
 * subset Lark reads, and literal text that Lark will not read as markup at all.
 *
 * Both exist because notices quote what people outside this repo wrote, and Lark markdown is
 * not inert: `<at id=all></at>` inside it mentions the whole group, and `<font>` recolours a
 * card. So every `<` that reaches Lark is escaped to `&#60;` -- the tag is shown, never obeyed.
 * An `&` that starts an entity is escaped too, or `&#60;at id=all>` written by hand would
 * decode into the very tag the first escape removed.
 *
 * Card JSON 1.0 and not 2.0, which renders CommonMark whole: Lark documents 2.0 for app bots,
 * and a custom-bot webhook is the only channel CI has. What 1.0 lacks is translated rather
 * than shown raw -- a heading becomes a bold line, `* item` becomes `- item`, a GitHub emoji
 * shortcode becomes the emoji, and an image becomes a link because 1.0 accepts only an
 * uploaded image key and refuses the whole card for anything else.
 */

/** Lark's documented escapes, as HTML numeric entities. */
const ENTITY: ReadonlyMap<string, string> = new Map([
  ["&", "&#38;"],
  ["<", "&#60;"],
  [">", "&#62;"],
  ["*", "&#42;"],
  ["_", "&#95;"],
  ["~", "&#126;"],
  ["`", "&#96;"],
  ["[", "&#91;"],
  ["]", "&#93;"],
]);

const MARKUP_CHARS = /[&<>*_~`[\]]/gu;
const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/gu;
const AUTOLINK = /<(?<url>https?:\/\/[^\s<>]+)>/gu;
/** The tags GitHub bodies actually carry; the text between them is kept. */
const HTML_TAG =
  /<\/?(?:a|b|br|code|details|div|em|h[1-6]|hr|i|img|kbd|p|picture|pre|source|span|strong|sub|summary|sup)\b[^>]*>/giu;
const ENTITY_START = /&(?=#?\w+;)/gu;
const IMAGE = /!\[(?<alt>[^\]]*)\]\(/gu;
const HEADING = /^#{1,6}\s+(?<text>.+?)(?:\s+#+)?\s*$/u;
const BULLET = /^(?<indent>\s*)[*+]\s+/u;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,}|={3,})\s*$/u;
const SHORTCODE = /:(?<name>[a-z0-9_+-]+):/gu;
const BLANK_RUN = /\n{3,}/gu;

/**
 * The shortcodes GitHub's release, bot and template text uses. One that is not here is left
 * as written -- a visible `:name:` rather than a guessed picture.
 */
const EMOJI: ReadonlyMap<string, string> = new Map([
  ["+1", "👍"],
  ["-1", "👎"],
  ["art", "🎨"],
  ["arrow_down", "⬇️"],
  ["arrow_up", "⬆️"],
  ["bangbang", "‼️"],
  ["book", "📖"],
  ["books", "📚"],
  ["boom", "💥"],
  ["bug", "🐛"],
  ["bulb", "💡"],
  ["construction", "🚧"],
  ["eyes", "👀"],
  ["fire", "🔥"],
  ["gear", "⚙️"],
  ["hammer", "🔨"],
  ["heart", "❤️"],
  ["heavy_check_mark", "✔️"],
  ["heavy_minus_sign", "➖"],
  ["heavy_plus_sign", "➕"],
  ["information_source", "ℹ️"],
  ["link", "🔗"],
  ["lock", "🔒"],
  ["memo", "📝"],
  ["package", "📦"],
  ["pencil", "📝"],
  ["pencil2", "✏️"],
  ["pushpin", "📌"],
  ["recycle", "♻️"],
  ["robot", "🤖"],
  ["rocket", "🚀"],
  ["rotating_light", "🚨"],
  ["sparkles", "✨"],
  ["star", "⭐"],
  ["tada", "🎉"],
  ["test_tube", "🧪"],
  ["warning", "⚠️"],
  ["white_check_mark", "✅"],
  ["wrench", "🔧"],
  ["x", "❌"],
  ["zap", "⚡"],
]);

/** `text` exactly as written: no character in it is read as Lark markup. */
export function larkLiteral(text: string): string {
  return text.replace(MARKUP_CHARS, (char) => ENTITY.get(char) ?? char);
}

function translateLine(line: string): string {
  if (RULE.test(line)) {
    // Lark draws a rule only for ` ---` on its own line; a bare `---` is shown as dashes.
    return " ---";
  }
  const heading = HEADING.exec(line);
  if (heading !== null) {
    return `**${heading.groups?.text}**`;
  }
  return line.replace(BULLET, "$<indent>- ");
}

/** GitHub-flavoured `markdown` as a Lark card's `markdown` element renders it. */
export function larkMarkdown(markdown: string): string {
  const safe = markdown
    .replaceAll("\r\n", "\n")
    .replace(HTML_COMMENT, "")
    .replace(AUTOLINK, (_, url: string) => `[${url}](${url})`)
    .replace(HTML_TAG, "")
    .replace(ENTITY_START, "&#38;")
    .replaceAll("<", "&#60;");
  return safe
    .replace(IMAGE, (_, alt: string) => `[${alt === "" ? "image" : alt}](`)
    .split("\n")
    .map(translateLine)
    .join("\n")
    .replace(SHORTCODE, (code, name: string) => EMOJI.get(name) ?? code)
    .replace(BLANK_RUN, "\n\n")
    .trim();
}
