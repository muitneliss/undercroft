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
 */

import { useTranslation } from "react-i18next";

import { RELEASE } from "@/lib/release";

export function Colophon() {
  const { t } = useTranslation();

  return (
    <footer className="colophon">
      <span className="label">{t("app.release")}</span>
      <span className="datum">{RELEASE}</span>
    </footer>
  );
}
