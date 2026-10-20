/**
 * The colophon: which printing of the manual this is, set at the foot of the leaf.
 *
 * A printed manual states its edition on the title page and repeats it in the colophon,
 * and that is exactly the pair of places this appears -- the title page, because a sign-in
 * that will not work is reported before anyone is inside; and the foot of every signed-in
 * leaf, because "which version are you on" is the first question asked about a bug and the
 * operator should not have to leave the screen they are describing to answer it.
 *
 * Deliberately NOT in the running head. That corner holds the address, the language pair
 * and sign-out -- three things a reader acts on. A stamp nobody can press, parked among
 * them, is the kind of ornament that makes a real control harder to find.
 *
 * The tag is set in the mono face and printed VERBATIM, `v` and all. It is not decoration
 * and it is not prose: it is the literal string an operator pastes into `IMAGE_TAG` to
 * roll the stack back to this build, so a prettier "1.4.0" would be a worse answer. The
 * word beside it is what makes the line mean something to a screen reader, which would
 * otherwise read a bare version number with nothing to attach it to.
 *
 * The far end of the line holds its two links, kept together and set apart from the label
 * and the tag it names: first the credit to Kanna, the partner product, then the contact
 * address, which closes the line as it closes multnelis.org's and the blog's -- the foot is
 * where a reader looks for who answers, and the colophon is the one foot every page shares.
 *
 * The credit opens a new tab. This foot sits under every signed-in leaf, a model half
 * written among them, and a footnote must not be the thing that navigates a reader away
 * from unsaved work. `noopener` because the page it opens is not ours to hand a window to.
 */

import { useTranslation } from "react-i18next";

import { CONTACT_EMAIL } from "@/lib/contact.ts";
import { KANNA_URL } from "@/lib/partner.ts";
import { RELEASE } from "@/lib/release.ts";

export function Colophon(): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <footer className="colophon">
      <span className="label">{t("app.release")}</span>
      <span className="datum">{RELEASE}</span>
      <span className="colophon__end">
        <a href={KANNA_URL} rel="noopener" target="_blank">
          {t("app.partner")}
        </a>
        <span className="colophon__contact">
          <span className="label">{t("app.contact")}</span>
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </span>
      </span>
    </footer>
  );
}
