/**
 * Where the reader types, and the one plate that sends it.
 *
 * The draft is in the Zustand store, not in the element and not in `useState` -- which is
 * banned here and gated (`.claude/rules/state.md`). That is not only rule compliance: the
 * interleaf unmounts when it closes, so a reader who shut the panel mid-sentence finds the
 * sentence still there when they open it again.
 *
 * A LABEL, not a placeholder standing in for one. A placeholder disappears the moment somebody
 * types into it, which is the moment they most want to know what the box is for; and it is not
 * read by every screen reader as a name. `.field` is the caption-over-box primitive this
 * application already sets every other input in.
 *
 * A `<form>` rather than a keydown handler on the input, so Enter submits because that is what
 * a form does -- and so the plate is a real submit button for a keyboard and for assistive
 * technology, rather than a div that happens to be clickable.
 */

import { useTranslation } from "react-i18next";

import { useUiStore } from "@/store.ts";

export function Composer({
  answering,
  onAsk,
  onStop,
}: {
  answering: boolean;
  onAsk: (text: string) => void;
  onStop: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const draft = useUiStore((state) => state.assistantDraft);
  const setDraft = useUiStore((state) => state.setAssistantDraft);

  const ready = draft.trim() !== "" && !answering;

  return (
    <form
      // `row row--field`, never a bare `.row`: the row holds a `.field`, so it aligns to the
      // field's bottom edge and the plate is struck to the input's height. A centred row hangs
      // the send plate half a caption above the box it sends. Gated by `row-field-alignment`
      // (ADR 0027) and pinned in `layout.test.ts`.
      className="row row--field"
      onSubmit={(event): void => {
        event.preventDefault();
        if (!ready) {
          return;
        }
        onAsk(draft.trim());
        // Cleared here rather than by the sender: the draft is this component's to own, and a
        // question left in the box after being asked reads as one that was not.
        setDraft("");
      }}
    >
      <label className="field">
        <span className="label">{t("assistant.askLabel")}</span>
        <input
          className="input"
          type="text"
          value={draft}
          placeholder={t("assistant.askPlaceholder")}
          onChange={(event): void => setDraft(event.target.value)}
          disabled={answering}
        />
      </label>

      {answering ? (
        // Stop is not a second primary action; it replaces the first. Two live plates would
        // ask the reader which one they meant while the answer was still arriving.
        <button className="plate" type="button" onClick={onStop}>
          {t("assistant.stop")}
        </button>
      ) : (
        <button className="plate plate--primary" type="submit" disabled={!ready}>
          {t("assistant.send")}
        </button>
      )}
    </form>
  );
}
