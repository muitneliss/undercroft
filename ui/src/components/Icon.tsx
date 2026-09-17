/**
 * The drawn marks.
 *
 * Every glyph in this interface is authored geometry on one 16-unit grid at one
 * 1.5-unit stroke. The interface this replaced set its statuses in Unicode
 * (`●▲◆○`), which renders at a different weight, size and baseline in every font
 * on every platform, and carries a name a screen reader may or may not read
 * aloud -- "black circle", "black up-pointing triangle". A status vocabulary
 * cannot be built out of characters whose appearance is not ours to decide.
 *
 * The four state marks are deliberately four different GEOMETRIES rather than
 * four fills of one shape: solid, half, struck, and open. That is what makes the
 * schedule readable in greyscale, at a glance, and to an operator who cannot
 * separate the hues -- the shape carries the state, the word confirms it, and
 * the hue is the third carrier rather than the only one (WCAG 2.1 AA 1.4.1).
 *
 * All of them are `aria-hidden`: each is rendered beside its own word, so
 * announcing the mark as well would say everything twice.
 */

type IconProps = {
  size?: number;
  className?: string;
};

function Frame({
  size = 16,
  className,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

/** Granted: the hole punched and inked solid. */
export function MarkGranted(props: IconProps) {
  return (
    <Frame {...props}>
      <circle cx="8" cy="8" r="5.25" fill="currentColor" stroke="none" />
    </Frame>
  );
}

/** Awaiting scope: the leaf half-hinged, inked on one side only. */
export function MarkPending(props: IconProps) {
  return (
    <Frame {...props}>
      <path d="M8 2.75A5.25 5.25 0 0 0 8 13.25Z" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="5.25" />
    </Frame>
  );
}

/** Lapsed: struck through, the way a withdrawn entry is struck in a register. */
export function MarkLapsed(props: IconProps) {
  return (
    <Frame {...props}>
      <circle cx="8" cy="8" r="5.25" />
      <path d="M4.3 11.7 11.7 4.3" />
    </Frame>
  );
}

/** Not granted: the outline printed, nothing filled in yet. */
export function MarkAbsent(props: IconProps) {
  return (
    <Frame {...props}>
      <circle cx="8" cy="8" r="5.25" strokeDasharray="2.2 2" />
    </Frame>
  );
}

/** The manual's "go on". */
export function ArrowRight(props: IconProps) {
  return (
    <Frame {...props}>
      <path d="M2.5 8h11" />
      <path d="M9.5 4 13.5 8l-4 4" />
    </Frame>
  );
}

export function ArrowLeft(props: IconProps) {
  return (
    <Frame {...props}>
      <path d="M13.5 8h-11" />
      <path d="M6.5 4 2.5 8l4 4" />
    </Frame>
  );
}

/** Turn the leaf down. */
export function ChevronDown(props: IconProps) {
  return (
    <Frame {...props}>
      <path d="M3.5 6 8 10.5 12.5 6" />
    </Frame>
  );
}

/** Turn the leaf back up. */
export function ChevronUp(props: IconProps) {
  return (
    <Frame {...props}>
      <path d="M3.5 10 8 5.5 12.5 10" />
    </Frame>
  );
}

/** Take the bytes off the shelf. */
export function Download(props: IconProps) {
  return (
    <Frame {...props}>
      <path d="M8 2.5v8" />
      <path d="M4.5 7.5 8 11l3.5-3.5" />
      <path d="M2.75 13.25h10.5" />
    </Frame>
  );
}

/** Errata: the correction mark itself. */
export function Errata(props: IconProps) {
  return (
    <Frame {...props}>
      <path d="M3.5 3.5 12.5 12.5" />
      <path d="M12.5 3.5 3.5 12.5" />
    </Frame>
  );
}

/** Add a leaf to the book. */
export function Plus(props: IconProps) {
  return (
    <Frame {...props}>
      <path d="M8 2.75v10.5" />
      <path d="M2.75 8h10.5" />
    </Frame>
  );
}

/** A stored object: a stack of versions under one key. */
export function Stack(props: IconProps) {
  return (
    <Frame {...props}>
      <path d="M2.5 5.5 8 2.75l5.5 2.75L8 8.25 2.5 5.5Z" />
      <path d="M2.5 10.5 8 13.25l5.5-2.75" />
      <path d="M2.5 8 8 10.75 13.5 8" />
    </Frame>
  );
}
