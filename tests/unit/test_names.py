"""One normalizer, and it must not over-merge.

The legacy repo carried three divergent copies of this before consolidating, and
still has a fourth that drifted. Two normalizers means two answers to "are these
the same company", and the disagreement surfaces as a customer appearing twice.
"""

from vcdo.core.names import norm_name


def test_the_same_company_written_two_ways_matches():
    assert norm_name("Synthetic Alpha Pte Ltd") == norm_name("SYNTHETIC ALPHA PTE. LTD.")


def test_spacing_does_not_prevent_a_match():
    assert norm_name("Alpha Tech") == norm_name("AlphaTech")


def test_vietnamese_diacritics_fold():
    """`d` has no NFKD decomposition, so missing it means Dong and Dong never match."""
    assert norm_name("Dong Phuong Co") == norm_name("Đông Phương Co")


def test_vietnamese_legal_prefixes_are_stripped():
    assert norm_name("Cong Ty TNHH Alpha") == norm_name("Alpha")
    assert norm_name("Cong Ty TNHH Mot Thanh Vien Alpha") == norm_name("Alpha")


def test_ampersand_and_the_word_and_agree():
    assert norm_name("Alpha & Beta") == norm_name("Alpha and Beta")


def test_different_companies_do_not_collide():
    """Over-merging is the expensive direction: it silently unites two customers."""
    assert norm_name("Cloudflare") != norm_name("Cloud")
    assert norm_name("Synthetic Alpha") != norm_name("Synthetic Beta")


def test_a_name_that_is_only_a_legal_form_yields_nothing():
    """ "Pte Ltd" and "Co Ltd" are not the same company; they are two unread names."""
    assert norm_name("Pte Ltd") == ""
    assert norm_name("Co Ltd") == ""


def test_empty_input_yields_empty_key():
    assert norm_name("") == ""
    assert norm_name(None) == ""
    assert norm_name("   ") == ""
