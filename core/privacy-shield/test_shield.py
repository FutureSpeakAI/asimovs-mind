"""
Privacy Shield — Comprehensive Test Suite
Tests all PII categories, allowlist, watchlist, round-trip, mixed content, and edge cases.
"""

import os
import json
import pytest
from shield import (
    PIICategory, PIIMatch,
    fnv1a_hash, make_placeholder,
    scan_text, scrub_text, unscrub_text,
    allowlist_add, allowlist_show, allowlist_clear,
    watchlist_add, watchlist_remove, watchlist_show, watchlist_clear, watchlist_reset,
    _luhn_check,
    ALLOWLIST_PATH, WATCHLIST_PATH,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def clean_allowlist():
    """Ensure allowlist is clean before/after each test."""
    if os.path.exists(ALLOWLIST_PATH):
        os.remove(ALLOWLIST_PATH)
    yield
    if os.path.exists(ALLOWLIST_PATH):
        os.remove(ALLOWLIST_PATH)


@pytest.fixture(autouse=True)
def clean_watchlist():
    """Ensure watchlist file is removed so defaults are used."""
    if os.path.exists(WATCHLIST_PATH):
        os.remove(WATCHLIST_PATH)
    yield
    if os.path.exists(WATCHLIST_PATH):
        os.remove(WATCHLIST_PATH)


def has_category(matches, cat: PIICategory) -> bool:
    return any(m.category == cat for m in matches)


def get_by_category(matches, cat: PIICategory):
    return [m for m in matches if m.category == cat]


# ---------------------------------------------------------------------------
# FNV-1a Hash Tests
# ---------------------------------------------------------------------------

class TestFNV1a:
    def test_deterministic(self):
        """Same input always produces same hash."""
        assert fnv1a_hash("hello") == fnv1a_hash("hello")

    def test_different_inputs(self):
        """Different inputs produce different hashes."""
        assert fnv1a_hash("hello") != fnv1a_hash("world")

    def test_returns_hex_string(self):
        """Hash is a 16-char hex string."""
        h = fnv1a_hash("test")
        assert len(h) == 16
        assert all(c in "0123456789abcdef" for c in h)

    def test_placeholder_format(self):
        """Placeholder follows [CATEGORY:hash] format."""
        p = make_placeholder(PIICategory.SSN, "123-45-6789")
        assert p.startswith("[SSN:")
        assert p.endswith("]")
        assert len(p) == len("[SSN:") + 16 + 1  # hash + ]


# ---------------------------------------------------------------------------
# Luhn Validation Tests
# ---------------------------------------------------------------------------

class TestLuhn:
    def test_valid_visa(self):
        assert _luhn_check("4532015112830366") is True

    def test_valid_mastercard(self):
        assert _luhn_check("5425233430109903") is True

    def test_valid_amex(self):
        """Amex has 15 digits — Luhn should handle it."""
        assert _luhn_check("378282246310005") is True

    def test_valid_amex_2(self):
        assert _luhn_check("371449635398431") is True

    def test_invalid_number(self):
        assert _luhn_check("1234567890123456") is False

    def test_too_short(self):
        assert _luhn_check("12345") is False


# ---------------------------------------------------------------------------
# SSN Detection
# ---------------------------------------------------------------------------

class TestSSN:
    def test_standard_format(self):
        matches = scan_text("My SSN is 123-45-6789.", allowlist=set())
        assert has_category(matches, PIICategory.SSN)
        assert matches[0].original == "123-45-6789"

    def test_in_sentence(self):
        text = "Please use SSN 987-65-4321 for the application."
        matches = scan_text(text, allowlist=set())
        assert has_category(matches, PIICategory.SSN)

    def test_no_false_positive_on_phone(self):
        """SSN pattern should not match phone numbers."""
        text = "Call (512) 814-7609 for details."
        matches = scan_text(text, categories=[PIICategory.SSN], allowlist=set())
        assert not has_category(matches, PIICategory.SSN)


# ---------------------------------------------------------------------------
# Credit Card Detection
# ---------------------------------------------------------------------------

class TestCreditCard:
    def test_dashed_format(self):
        # 4532-0151-1283-0366 passes Luhn
        matches = scan_text("Card: 4532-0151-1283-0366", allowlist=set())
        assert has_category(matches, PIICategory.CREDIT_CARD)

    def test_space_format(self):
        matches = scan_text("Card: 4532 0151 1283 0366", allowlist=set())
        assert has_category(matches, PIICategory.CREDIT_CARD)

    def test_invalid_luhn_rejected(self):
        """Numbers that fail Luhn should not be flagged."""
        matches = scan_text("Number: 1234-5678-9012-3456", allowlist=set())
        assert not has_category(matches, PIICategory.CREDIT_CARD)

    def test_realistic_visa(self):
        matches = scan_text("Visa ending 5425-2334-3010-9903", allowlist=set())
        assert has_category(matches, PIICategory.CREDIT_CARD)

    def test_amex_dashed_format(self):
        """Amex 4-6-5 grouping with dashes."""
        matches = scan_text("Amex: 3782-822463-10005", allowlist=set())
        assert has_category(matches, PIICategory.CREDIT_CARD)
        cc = get_by_category(matches, PIICategory.CREDIT_CARD)[0]
        assert "3782-822463-10005" in cc.original

    def test_amex_space_format(self):
        """Amex 4-6-5 grouping with spaces."""
        matches = scan_text("Card: 3782 822463 10005", allowlist=set())
        assert has_category(matches, PIICategory.CREDIT_CARD)

    def test_amex_contiguous(self):
        """Amex as 15 contiguous digits."""
        matches = scan_text("Card: 378282246310005", allowlist=set())
        assert has_category(matches, PIICategory.CREDIT_CARD)

    def test_amex_second_number(self):
        """Another valid Amex number (starts with 37)."""
        matches = scan_text("Amex: 3714-496353-98431", allowlist=set())
        assert has_category(matches, PIICategory.CREDIT_CARD)

    def test_amex_34_prefix(self):
        """Amex starting with 34."""
        # 340000000000009 is a test Amex number
        matches = scan_text("Card: 3400-000000-00009", allowlist=set())
        assert has_category(matches, PIICategory.CREDIT_CARD)


# ---------------------------------------------------------------------------
# Phone Number Detection
# ---------------------------------------------------------------------------

class TestPhone:
    def test_parentheses_format(self):
        matches = scan_text("Call (512) 814-7609 today.", allowlist=set())
        assert has_category(matches, PIICategory.PHONE)
        phone_matches = get_by_category(matches, PIICategory.PHONE)
        assert "(512) 814-7609" in phone_matches[0].original

    def test_dashed_format(self):
        matches = scan_text("Phone: 512-814-7609", allowlist=set())
        assert has_category(matches, PIICategory.PHONE)

    def test_dotted_format(self):
        matches = scan_text("Phone: 512.814.7609", allowlist=set())
        assert has_category(matches, PIICategory.PHONE)


# ---------------------------------------------------------------------------
# Email Detection
# ---------------------------------------------------------------------------

class TestEmail:
    def test_standard_email(self):
        matches = scan_text("Email me at test@example.com please.", allowlist=set())
        assert has_category(matches, PIICategory.EMAIL)
        email_matches = get_by_category(matches, PIICategory.EMAIL)
        assert email_matches[0].original == "test@example.com"

    def test_complex_email(self):
        matches = scan_text("Contact john.doe+work@company.co.uk", allowlist=set())
        assert has_category(matches, PIICategory.EMAIL)

    def test_not_a_url(self):
        """Should not match partial URLs without @."""
        matches = scan_text("Visit https://example.com", categories=[PIICategory.EMAIL], allowlist=set())
        assert not has_category(matches, PIICategory.EMAIL)


# ---------------------------------------------------------------------------
# Address Detection
# ---------------------------------------------------------------------------

class TestAddress:
    def test_full_address(self):
        text = "I live at 13304 Slow Poke Drive, Austin TX 78727."
        matches = scan_text(text, allowlist=set())
        assert has_category(matches, PIICategory.ADDRESS)
        addr = get_by_category(matches, PIICategory.ADDRESS)[0]
        assert "13304" in addr.original
        assert "Slow Poke" in addr.original

    def test_simple_street(self):
        text = "Office at 456 Main Street, Dallas TX 75201."
        matches = scan_text(text, allowlist=set())
        assert has_category(matches, PIICategory.ADDRESS)

    def test_abbreviated_suffix(self):
        text = "Send to 789 Oak Ave, Houston TX 77001."
        matches = scan_text(text, allowlist=set())
        assert has_category(matches, PIICategory.ADDRESS)

    def test_zip_included_in_match(self):
        """Address match must include the zip code when present."""
        text = "I live at 13304 Slow Poke Drive, Austin TX 78727."
        matches = scan_text(text, allowlist=set())
        addr = get_by_category(matches, PIICategory.ADDRESS)[0]
        assert "78727" in addr.original, f"Zip not captured. Got: {addr.original!r}"

    def test_zip_plus_four(self):
        """Address with ZIP+4 should be fully captured."""
        text = "Office at 456 Main Street, Dallas TX 75201-1234."
        matches = scan_text(text, allowlist=set())
        addr = get_by_category(matches, PIICategory.ADDRESS)[0]
        assert "75201-1234" in addr.original, f"ZIP+4 not captured. Got: {addr.original!r}"

    def test_street_only_no_city(self):
        """Address without city/state/zip should still match."""
        text = "Located at 100 Broadway Avenue."
        matches = scan_text(text, categories=[PIICategory.ADDRESS], allowlist=set())
        assert has_category(matches, PIICategory.ADDRESS)

    def test_multi_word_city(self):
        """City names with multiple words should be captured."""
        text = "Office at 123 Elm Street, Fort Worth TX 76102."
        matches = scan_text(text, allowlist=set())
        addr = get_by_category(matches, PIICategory.ADDRESS)[0]
        assert "Fort Worth" in addr.original
        assert "76102" in addr.original


# ---------------------------------------------------------------------------
# Medical Information Detection
# ---------------------------------------------------------------------------

class TestMedical:
    def test_medication_name(self):
        text = "Patient takes metformin 500mg daily."
        matches = scan_text(text, allowlist=set())
        assert has_category(matches, PIICategory.MEDICAL)

    def test_diagnosis(self):
        text = "Diagnosed with type 2 diabetes in 2019."
        matches = scan_text(text, allowlist=set())
        assert has_category(matches, PIICategory.MEDICAL)

    def test_brand_name_drug(self):
        text = "Currently on Ozempic for weight management."
        matches = scan_text(text, allowlist=set())
        assert has_category(matches, PIICategory.MEDICAL)

    def test_mental_health(self):
        text = "History of depression and anxiety."
        matches = scan_text(text, allowlist=set())
        medical = get_by_category(matches, PIICategory.MEDICAL)
        terms = [m.original.lower() for m in medical]
        assert "depression" in terms
        assert "anxiety" in terms

    def test_condition(self):
        text = "She was diagnosed with lupus last year."
        matches = scan_text(text, allowlist=set())
        assert has_category(matches, PIICategory.MEDICAL)

    def test_glp1_medication(self):
        """GLP-1 drug class must be caught."""
        text = "She started a GLP-1 medication for weight loss."
        matches = scan_text(text, allowlist=set())
        medical = get_by_category(matches, PIICategory.MEDICAL)
        terms = [m.original.lower() for m in medical]
        assert any("glp-1" in t for t in terms), f"GLP-1 not caught. Got: {terms}"

    def test_cigna_healthcare(self):
        """Insurance company Cigna Healthcare must be caught."""
        text = "She has Cigna Healthcare as her insurer."
        matches = scan_text(text, allowlist=set())
        medical = get_by_category(matches, PIICategory.MEDICAL)
        terms = [m.original.lower() for m in medical]
        assert any("cigna" in t for t in terms), f"Cigna not caught. Got: {terms}"

    def test_henry_meds(self):
        """Telehealth provider Henry Meds must be caught."""
        text = "He gets his prescription through Henry Meds."
        matches = scan_text(text, allowlist=set())
        medical = get_by_category(matches, PIICategory.MEDICAL)
        terms = [m.original.lower() for m in medical]
        assert any("henry meds" in t for t in terms), f"Henry Meds not caught. Got: {terms}"

    def test_medication_keyword(self):
        """The word 'medication' itself should trigger detection."""
        text = "She takes a daily medication."
        matches = scan_text(text, allowlist=set())
        assert has_category(matches, PIICategory.MEDICAL)

    def test_insurance_companies(self):
        """Major insurance companies must be caught."""
        for insurer in ["Cigna", "Aetna", "UnitedHealthcare", "Humana", "Kaiser"]:
            text = f"Insured by {insurer}."
            matches = scan_text(text, categories=[PIICategory.MEDICAL], allowlist=set())
            assert has_category(matches, PIICategory.MEDICAL), f"{insurer} not caught"

    def test_telehealth_telemedicine(self):
        """Telehealth/telemedicine terms must be caught."""
        for term in ["telehealth", "telemedicine"]:
            text = f"Appointment via {term} tomorrow."
            matches = scan_text(text, categories=[PIICategory.MEDICAL], allowlist=set())
            assert has_category(matches, PIICategory.MEDICAL), f"{term} not caught"

    def test_pharmacy_prescription(self):
        """Pharmacy and prescription terms must be caught."""
        for term in ["pharmacy", "prescription"]:
            text = f"Pick up at the {term}."
            matches = scan_text(text, categories=[PIICategory.MEDICAL], allowlist=set())
            assert has_category(matches, PIICategory.MEDICAL), f"{term} not caught"

    def test_adhd(self):
        """ADHD must be caught (case-insensitive)."""
        text = "He was diagnosed with ADHD as a child."
        matches = scan_text(text, allowlist=set())
        assert has_category(matches, PIICategory.MEDICAL)


# ---------------------------------------------------------------------------
# Government ID Detection
# ---------------------------------------------------------------------------

class TestGovernmentID:
    def test_passport(self):
        text = "Passport number: AB1234567"
        matches = scan_text(text, allowlist=set())
        assert has_category(matches, PIICategory.GOVERNMENT_ID)

    def test_drivers_license(self):
        text = "Driver's license: DL12345678"
        matches = scan_text(text, allowlist=set())
        assert has_category(matches, PIICategory.GOVERNMENT_ID)

    def test_dl_abbreviation(self):
        text = "DL# TX98765432"
        matches = scan_text(text, allowlist=set())
        assert has_category(matches, PIICategory.GOVERNMENT_ID)

    def test_state_code_dl(self):
        """State abbreviation + 7-8 digits: TX 12345678."""
        text = "Her DL is TX 12345678."
        matches = scan_text(text, allowlist=set())
        assert has_category(matches, PIICategory.GOVERNMENT_ID), \
            f"TX 12345678 not caught. Matches: {[(m.category, m.original) for m in matches]}"

    def test_state_code_with_letter_prefix(self):
        """State abbreviation + letter + digits: CA A1234567."""
        text = "License: CA A1234567"
        matches = scan_text(text, allowlist=set())
        assert has_category(matches, PIICategory.GOVERNMENT_ID), \
            f"CA A1234567 not caught. Matches: {[(m.category, m.original) for m in matches]}"

    def test_multiple_states(self):
        """Various state DL formats should be caught."""
        for state, num in [("FL", "W123456789"), ("NY", "12345678"), ("IL", "A12345678")]:
            text = f"License is {state} {num}."
            matches = scan_text(text, categories=[PIICategory.GOVERNMENT_ID], allowlist=set())
            assert has_category(matches, PIICategory.GOVERNMENT_ID), \
                f"{state} {num} not caught"


# ---------------------------------------------------------------------------
# Bank Account Detection
# ---------------------------------------------------------------------------

class TestBankAccount:
    def test_account_number(self):
        text = "Account #12345678901"
        matches = scan_text(text, allowlist=set())
        assert has_category(matches, PIICategory.BANK_ACCOUNT)

    def test_routing_number(self):
        text = "Routing: 021000021"
        matches = scan_text(text, allowlist=set())
        assert has_category(matches, PIICategory.BANK_ACCOUNT)

    def test_acct_abbreviation(self):
        text = "Acct 9876543210"
        matches = scan_text(text, allowlist=set())
        assert has_category(matches, PIICategory.BANK_ACCOUNT)


# ---------------------------------------------------------------------------
# Name Watchlist Detection
# ---------------------------------------------------------------------------

class TestNameWatchlist:
    def test_default_watchlist_loaded(self):
        """Default watchlist should contain the expected names."""
        names = watchlist_show()
        assert "Alex Rivera" in names
        assert "Jamie Chen" in names
        assert "Libby" in names

    def test_name_detected_in_text(self):
        """Names on the watchlist should be detected."""
        text = "Please contact Alex Rivera for details."
        matches = scan_text(text, allowlist=set())
        assert has_category(matches, PIICategory.NAME)
        name_match = get_by_category(matches, PIICategory.NAME)[0]
        assert name_match.original.lower() == "stephen webster"

    def test_full_name_with_middle(self):
        """Stephen C. Webster should be detected."""
        text = "The author is Stephen C. Webster."
        matches = scan_text(text, allowlist=set())
        name_matches = get_by_category(matches, PIICategory.NAME)
        originals = [m.original.lower() for m in name_matches]
        assert any("stephen c. webster" in o for o in originals)

    def test_case_insensitive(self):
        """Name matching should be case-insensitive."""
        text = "Email STEPHEN WEBSTER about the issue."
        matches = scan_text(text, allowlist=set())
        assert has_category(matches, PIICategory.NAME)

    def test_single_name_libby(self):
        """Single-word watchlist name 'Libby' should be caught."""
        text = "Tell Libby about the meeting."
        matches = scan_text(text, allowlist=set())
        assert has_category(matches, PIICategory.NAME)

    def test_janet_jay(self):
        """Jamie Chen should be caught."""
        text = "Jamie Chen will be attending."
        matches = scan_text(text, allowlist=set())
        assert has_category(matches, PIICategory.NAME)

    def test_elisabeth_donoghue_webster(self):
        """Taylor Nguyen-Park should be caught."""
        text = "Taylor Nguyen-Park was there."
        matches = scan_text(text, allowlist=set())
        assert has_category(matches, PIICategory.NAME)

    def test_watchlist_add(self):
        """Adding a name to watchlist should make it detectable."""
        watchlist_add("Jane Doe")
        text = "Send this to Jane Doe."
        matches = scan_text(text, allowlist=set())
        assert has_category(matches, PIICategory.NAME)

    def test_watchlist_remove(self):
        """Removing a name from watchlist should stop detection."""
        watchlist_remove("Libby")
        text = "Tell Libby about the meeting."
        matches = scan_text(text, categories=[PIICategory.NAME], allowlist=set())
        assert not has_category(matches, PIICategory.NAME)

    def test_watchlist_clear(self):
        """Clearing the watchlist should stop all name detection."""
        watchlist_clear()
        text = "Alex Rivera and Jamie Chen."
        matches = scan_text(text, categories=[PIICategory.NAME], allowlist=set())
        assert not has_category(matches, PIICategory.NAME)

    def test_watchlist_reset(self):
        """Resetting the watchlist should restore defaults."""
        watchlist_clear()
        watchlist_reset()
        names = watchlist_show()
        assert "Alex Rivera" in names

    def test_name_scrubbed_in_output(self):
        """Names should be scrubbed with [NAME:hash] placeholders."""
        text = "Contact Alex Rivera at the office."
        scrubbed, matches = scrub_text(text, allowlist=set())
        assert "Alex Rivera" not in scrubbed
        assert "[NAME:" in scrubbed

    def test_non_watchlist_name_not_caught(self):
        """Names NOT on the watchlist should pass through."""
        text = "Contact John Doe at the office."
        matches = scan_text(text, categories=[PIICategory.NAME], allowlist=set())
        assert not has_category(matches, PIICategory.NAME)


# ---------------------------------------------------------------------------
# Allowlist Tests
# ---------------------------------------------------------------------------

class TestAllowlist:
    def test_allowlisted_email_passes_through(self):
        """Allowlisted values should NOT be flagged."""
        allowlist_add("stephen@friday.com")
        items = allowlist_show()
        assert "stephen@friday.com" in items

        matches = scan_text("Contact stephen@friday.com for help.")
        assert not any(m.original == "stephen@friday.com" for m in matches)

    def test_non_allowlisted_still_caught(self):
        """Non-allowlisted PII should still be caught even with allowlist active."""
        allowlist_add("stephen@friday.com")
        matches = scan_text("Email evil@hacker.com or stephen@friday.com")
        emails = get_by_category(matches, PIICategory.EMAIL)
        originals = [m.original for m in emails]
        assert "evil@hacker.com" in originals
        assert "stephen@friday.com" not in originals

    def test_allowlist_clear(self):
        allowlist_add("foo@bar.com")
        allowlist_clear()
        assert allowlist_show() == []


# ---------------------------------------------------------------------------
# Scrub / Unscrub Round-Trip Tests
# ---------------------------------------------------------------------------

class TestRoundTrip:
    def test_scrub_and_unscrub(self):
        original = "My SSN is 123-45-6789 and email is test@example.com."
        scrubbed, matches = scrub_text(original, allowlist=set())
        
        # Scrubbed text should not contain original PII
        assert "123-45-6789" not in scrubbed
        assert "test@example.com" not in scrubbed
        
        # Should contain placeholders
        assert "[SSN:" in scrubbed
        assert "[EMAIL:" in scrubbed
        
        # Unscrub should restore original
        restored = unscrub_text(scrubbed, matches)
        assert restored == original

    def test_scrub_preserves_non_pii(self):
        original = "Hello world, no PII here."
        scrubbed, matches = scrub_text(original, allowlist=set())
        assert scrubbed == original
        assert matches == []

    def test_round_trip_with_all_categories(self):
        original = (
            "Name: John Doe\n"
            "SSN: 123-45-6789\n"
            "Phone: (512) 814-7609\n"
            "Email: test@example.com\n"
            "Takes metformin daily.\n"
            "Passport number: AB1234567\n"
        )
        scrubbed, matches = scrub_text(original, allowlist=set())
        restored = unscrub_text(scrubbed, matches)
        assert restored == original

    def test_deterministic_placeholders(self):
        """Same PII always gets the same placeholder."""
        _, matches1 = scrub_text("SSN: 123-45-6789", allowlist=set())
        _, matches2 = scrub_text("Also 123-45-6789 here", allowlist=set())
        assert matches1[0].replacement == matches2[0].replacement


# ---------------------------------------------------------------------------
# Mixed Content Tests
# ---------------------------------------------------------------------------

class TestMixedContent:
    def test_multiple_pii_types(self):
        text = (
            "Contact me at (512) 814-7609 or test@example.com. "
            "My SSN is 123-45-6789. I live at 456 Main Street, Austin TX 78701."
        )
        matches = scan_text(text, allowlist=set())
        categories = {m.category for m in matches}
        assert PIICategory.PHONE in categories
        assert PIICategory.EMAIL in categories
        assert PIICategory.SSN in categories
        assert PIICategory.ADDRESS in categories

    def test_paragraph_with_pii(self):
        text = (
            "Dear Dr. Smith, I am writing to confirm my appointment. "
            "You can reach me at (512) 814-7609 or email test@example.com. "
            "My insurance ID is on file. I currently take metformin and lisinopril. "
            "Please send documents to 13304 Slow Poke Drive, Austin TX 78727. "
            "My SSN for billing is 123-45-6789."
        )
        scrubbed, matches = scrub_text(text, allowlist=set())
        
        # Verify all PII removed
        assert "512" not in scrubbed or "[PHONE:" in scrubbed
        assert "test@example.com" not in scrubbed
        assert "metformin" not in scrubbed
        assert "lisinopril" not in scrubbed
        assert "123-45-6789" not in scrubbed
        assert "13304" not in scrubbed
        
        # Verify round-trip
        restored = unscrub_text(scrubbed, matches)
        assert restored == text

    def test_real_world_scenario(self):
        """Simulates the exact gaps reported in the bug."""
        text = (
            "Alex Rivera filled his GLP-1 medication through Henry Meds. "
            "His Cigna Healthcare plan covers it. "
            "His DL is TX 12345678. "
            "He lives at 13304 Slow Poke Drive, Austin TX 78727."
        )
        scrubbed, matches = scrub_text(text, allowlist=set())

        # Name should be scrubbed
        assert "Alex Rivera" not in scrubbed
        # Medical terms should be scrubbed
        assert "GLP-1" not in scrubbed
        assert "Henry Meds" not in scrubbed
        assert "Cigna" not in scrubbed
        # DL should be scrubbed
        assert "TX 12345678" not in scrubbed
        # Full address with zip should be scrubbed
        assert "78727" not in scrubbed
        assert "13304" not in scrubbed


# ---------------------------------------------------------------------------
# Edge Cases
# ---------------------------------------------------------------------------

class TestEdgeCases:
    def test_empty_string(self):
        matches = scan_text("", allowlist=set())
        assert matches == []

    def test_no_pii(self):
        matches = scan_text("Just a normal sentence with no sensitive data.", allowlist=set())
        assert matches == []

    def test_only_pii(self):
        text = "123-45-6789"
        scrubbed, matches = scrub_text(text, allowlist=set())
        assert len(matches) == 1
        assert "123-45-6789" not in scrubbed

    def test_category_filtering(self):
        """When filtering to specific categories, others should be ignored."""
        text = "SSN 123-45-6789 and email test@example.com"
        matches = scan_text(text, categories=[PIICategory.SSN], allowlist=set())
        assert all(m.category == PIICategory.SSN for m in matches)
        assert not has_category(matches, PIICategory.EMAIL)

    def test_repeated_pii(self):
        """Same PII appearing multiple times should be caught each time."""
        text = "Call (512) 814-7609 or (512) 814-7609."
        matches = scan_text(text, categories=[PIICategory.PHONE], allowlist=set())
        phones = get_by_category(matches, PIICategory.PHONE)
        assert len(phones) == 2

    def test_pii_at_boundaries(self):
        """PII at start and end of text."""
        text = "123-45-6789 is my SSN and call (512) 814-7609"
        matches = scan_text(text, allowlist=set())
        assert has_category(matches, PIICategory.SSN)
        assert has_category(matches, PIICategory.PHONE)


# ---------------------------------------------------------------------------
# Category-specific scan tests
# ---------------------------------------------------------------------------

class TestCategorySpecificScan:
    def test_scan_only_emails(self):
        text = "Email test@example.com, SSN 123-45-6789"
        matches = scan_text(text, categories=[PIICategory.EMAIL], allowlist=set())
        assert len(matches) == 1
        assert matches[0].category == PIICategory.EMAIL

    def test_scan_only_phones(self):
        text = "Call (512) 814-7609, email test@example.com"
        matches = scan_text(text, categories=[PIICategory.PHONE], allowlist=set())
        assert len(matches) == 1
        assert matches[0].category == PIICategory.PHONE
