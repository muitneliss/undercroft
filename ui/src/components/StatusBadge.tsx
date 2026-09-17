/**
 * A status badge that never relies on colour alone.
 *
 * WCAG 2.1 AA 1.4.1: colour must not be the only means of conveying
 * information. Every badge therefore carries a glyph and a word as well as a
 * tone, which also means it survives a greyscale screenshot in a runbook.
 */

type Tone = "positive" | "negative" | "attention" | "neutral";

const GLYPH: Record<Tone, string> = {
  positive: "●",
  negative: "▲",
  attention: "◆",
  neutral: "○",
};

export function StatusBadge({
  tone,
  label,
  description,
}: {
  tone: Tone;
  label: string;
  description?: string;
}) {
  return (
    <span className={`badge badge--${tone}`} title={description}>
      <span aria-hidden="true">{GLYPH[tone]}</span>
      {label}
      {description ? <span className="visually-hidden">. {description}</span> : null}
    </span>
  );
}
