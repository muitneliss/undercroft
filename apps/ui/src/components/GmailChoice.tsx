/**
 * Gmail's choice: which labels, and what choosing none means said as it is chosen.
 *
 * Its own module for the reason `XeroChoice` and `HubspotChoice` have one: it is a control,
 * not a page, and the scope picker is the page that chooses between four of them.
 */

import { useTranslation } from "react-i18next";

import { ChoiceEcho } from "@/components/ChoiceEcho.tsx";
import { LabelIndex } from "@/components/LabelIndex.tsx";
import type { BrowsedLabel } from "@/lib/labelIndex.ts";
import { useUiStore } from "@/store.ts";

/**
 * Gmail's choice: which labels, and what choosing none means said as it is chosen.
 *
 * "Choosing no label means the whole mailbox" is printed above the list, and a hint above a
 * long list is read once and then scrolled away from. So the consequence also stands beneath
 * the control, as a line that changes as the ticks change, in the consent card's own
 * sentence -- and it carries `role="status"`, so a screen reader is told the same thing at
 * the same moment instead of being left to infer it from a checkbox.
 */
export function GmailChoice({
  source,
  items,
  chosen,
}: {
  source: string;
  items: readonly BrowsedLabel[];
  chosen: readonly string[];
}): React.JSX.Element {
  const { t } = useTranslation();
  const clearLabels = useUiStore((s) => s.clearScopeLabels);
  const selectAllLabels = useUiStore((s) => s.selectAllScopeLabels);

  if (items.length === 0) {
    return <p className="note">{t("scopePicker.nothingToChoose")}</p>;
  }

  // Every label the mailbox listed, not only those a filter leaves on screen: the control sits
  // beneath the whole index and says "all", and a filter is a way of looking, not a choice.
  const offered = items.map((label) => label.name);

  return (
    <>
      <LabelIndex source={source} items={items} chosen={chosen} />

      <ChoiceEcho
        chosen={chosen}
        offered={offered}
        says={{
          none: t("scope.gmailWholeMailbox"),
          some: t("scopePicker.echoChosen", { count: chosen.length }),
          every: t("scopePicker.echoEveryLabel"),
        }}
        onSelectAll={(): void => {
          selectAllLabels(source, offered);
        }}
        onClear={(): void => {
          clearLabels(source);
        }}
      />
    </>
  );
}
