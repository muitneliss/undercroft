"""The single name normalizer, for matching only.

Ported from the legacy repo's ``vcc/names.py``. That repo learned this the hard
way twice over: it had three divergent copies before consolidating, and still
carries a fourth in ``build_xero_revenue_mart.normalise_name`` that drifted from
the canonical one. Two normalizers means two answers to "are these the same
company", and the disagreement surfaces as a customer silently appearing twice.

**This output is a matching key, not a display value.** It is lossy on purpose:
"Synthetic Alpha Pte Ltd" and "SYNTHETIC ALPHA PTE. LTD." must collapse to the
same key. Never show it to a human and never store it as a name.

A normalised name is *weak* evidence of identity. It is enough to propose a link
for review; it is never enough to merge two records on its own. See the entity
identity laws in the legacy repo's ``docs/64``.
"""

from __future__ import annotations

import re
import unicodedata

__all__ = ["norm_name"]

# Singapore and English legal forms. Stripped iteratively from the end, because
# "Pte Ltd" leaves "Pte" behind after one pass.
_SUFFIXES = (
    "pte ltd",
    "pte limited",
    "private limited",
    "pte",
    "ltd",
    "limited",
    "company limited",
    "co ltd",
    "llp",
    "llc",
    "inc",
    "corporation",
    "corp",
    "jsc",
    "co",
    "company",
)

# Vietnamese legal forms, which lead rather than trail. Longest first so
# "cong ty tnhh mot thanh vien" is not truncated to "cong ty tnhh" mid-strip.
_PREFIXES = (
    "cong ty co phan",
    "cong ty tnhh mot thanh vien",
    "cong ty tnhh mtv",
    "cong ty tnhh",
    "cong ty",
    "ctcp",
)

_PUNCT = re.compile(r"[^a-z0-9\s]")
_SPACE = re.compile(r"\s+")


def norm_name(value: str | None) -> str:
    """Normalise a company name to a matching key.

    Returns ``""`` when the input is empty or consists only of a legal form.
    An empty key must never match another empty key -- "Pte Ltd" and "Co Ltd" are
    not the same company, they are two names we failed to read.
    """
    if not value:
        return ""

    text = value.strip().lower()

    # Vietnamese diacritics fold to ASCII, but `đ` has no decomposition so it
    # survives NFKD and must be handled explicitly. Missing it means "Đông" and
    # "Dong" never match.
    text = text.replace("đ", "d").replace("Đ", "d")
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))

    text = text.replace("&", " and ")
    text = _PUNCT.sub(" ", text)
    text = _SPACE.sub(" ", text).strip()

    # Iterate: a name may carry more than one legal form, and stripping one can
    # expose another.
    changed = True
    while changed and text:
        changed = False

        # A name consisting of nothing but a legal form carries no identity.
        # Without this, "Pte Ltd" strips its trailing " ltd" and returns "pte",
        # which would then match any other unread name that happened to reduce
        # the same way -- silently uniting two different companies.
        if text in _SUFFIXES or text in _PREFIXES:
            return ""

        for prefix in _PREFIXES:
            if text.startswith(prefix + " "):
                text = text[len(prefix) :].strip()
                changed = True
                break
        for suffix in _SUFFIXES:
            if text.endswith(" " + suffix):
                text = text[: -len(suffix)].strip()
                changed = True
                break

    # Spaces removed last, so "Alpha Tech" and "AlphaTech" agree.
    return text.replace(" ", "")
