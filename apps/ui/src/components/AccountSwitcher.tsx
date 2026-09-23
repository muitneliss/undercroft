/**
 * The accounts of one kind -- two Gmail mailboxes, say -- and which of them the card below is
 * about.
 *
 * Since ADR 0043 a tenant may connect several Gmail mailboxes and several Drive accounts, and
 * each is a connection of its own with its own grant, scope, schedule and last run. The
 * schedule still shows ONE card per kind, because four vendors is the shape of the page; this
 * is what chooses which account that card is, and it is also where each account's health is
 * read at a glance, because every option carries its account's own mark. A lapsed second
 * mailbox is therefore visible without opening it -- one aggregate mark over two mailboxes
 * could not have said which of them stopped.
 *
 * A NATIVE RADIO GROUP, NOT A TAB STRIP. Choosing an account is choosing one value out of a
 * few, which is what a radio group is, and native radios in a `<fieldset>` bring the arrow
 * keys, the group's name (from the `<legend>`) and the "2 of 3" announcement for nothing. They
 * are set as punches -- the hole this system marks every selection with -- so they look like
 * the rest of the book. `TabRail` is not reused: it is the application's navigation, hard-wired
 * to divisions, and an account is not a place.
 *
 * Controlled and wordless about where the choice lives: the route reads it from the store and
 * hands back `onSelect`. That keeps this renderable with no store, router or tRPC client behind
 * it, like `ConnectionCard`.
 */

import { useTranslation } from "react-i18next";

import { type Connection, SOURCE_LABEL, type Source } from "@/api/types.ts";
import { StatusMark } from "@/components/StatusMark.tsx";
import { connectionFacts, MARK_LABEL } from "@/lib/connectionState.ts";

export function AccountSwitcher({
  kind,
  accounts,
  selected,
  onSelect,
  canAdd,
  busy,
  onAdd,
}: {
  kind: Source;
  /** Every account of `kind`, in the schedule's order. */
  accounts: readonly Connection[];
  /** The source of the account on show. */
  selected: string;
  onSelect: (source: string) => void;
  /** Whether the reader may connect another account. Courtesy; the server refuses regardless. */
  canAdd: boolean;
  busy: boolean;
  /** Start the consent for a further account of `kind`. */
  onAdd: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const name = SOURCE_LABEL[kind];

  return (
    <fieldset className="accounts">
      <legend className="label accounts__legend">{t("grant.accountsLegend", { name })}</legend>
      <div className="row">
        {accounts.map((account) => {
          // The card's own mark, from the card's own decision: an account reads the same in
          // the switcher as on its card, because both ask `connectionFacts`.
          const { mark } = connectionFacts(account);
          return (
            <label key={account.source} className="punch">
              <input
                type="radio"
                // One group per kind: the two groups on the page must not share a name, or
                // choosing a Drive account would clear the Gmail one.
                name={`account-${kind}`}
                value={account.source}
                checked={account.source === selected}
                onChange={(): void => {
                  onSelect(account.source);
                }}
              />
              <span className="punch__box" />
              <span>
                {account.externalAccountLabel === ""
                  ? t("grant.unnamedAccount")
                  : account.externalAccountLabel}
              </span>
              <StatusMark mark={mark} label={t(MARK_LABEL[mark])} />
            </label>
          );
        })}

        {canAdd ? (
          <button type="button" className="plate plate--small" onClick={onAdd} disabled={busy}>
            {t("grant.addAccount")}
          </button>
        ) : null}
      </div>
    </fieldset>
  );
}
