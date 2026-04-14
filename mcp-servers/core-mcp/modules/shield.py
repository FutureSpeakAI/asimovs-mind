"""
Privacy Shield — PII Detection and Scrubbing Module
Phase 2 of Agent Friday's core systems.

Scans text for personally identifiable information (PII) across 9 categories
and replaces matches with FNV-1a hashed placeholders.
"""

import re
from enum import Enum, auto
from dataclasses import dataclass, field
from typing import Optional
import json
import os


# ---------------------------------------------------------------------------
# PII Categories
# ---------------------------------------------------------------------------

class PIICategory(Enum):
    SSN = auto()
    CREDIT_CARD = auto()
    BANK_ACCOUNT = auto()
    PHONE = auto()
    EMAIL = auto()
    ADDRESS = auto()
    MEDICAL = auto()
    GOVERNMENT_ID = auto()
    NAME = auto()


# ---------------------------------------------------------------------------
# PII Match dataclass
# ---------------------------------------------------------------------------

@dataclass
class PIIMatch:
    category: PIICategory
    original: str
    replacement: str
    start: int
    end: int


# ---------------------------------------------------------------------------
# FNV-1a Hash
# ---------------------------------------------------------------------------

FNV_OFFSET_BASIS = 0xcbf29ce484222325
FNV_PRIME = 0x100000001b3
FNV_MOD = 2 ** 64


def fnv1a_hash(data: str) -> str:
    h = FNV_OFFSET_BASIS
    for byte in data.encode("utf-8"):
        h ^= byte
        h = (h * FNV_PRIME) % FNV_MOD
    return format(h, "016x")


def make_placeholder(category: PIICategory, original: str) -> str:
    h = fnv1a_hash(original)
    return f"[{category.name}:{h}]"


# ---------------------------------------------------------------------------
# Allowlist — uses DATA_DIR env var for storage
# ---------------------------------------------------------------------------

def _get_allowlist_path() -> str:
    data_dir = os.environ.get("FRIDAY_DATA_DIR", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(data_dir, ".allowlist.json")


def _load_allowlist() -> set[str]:
    path = _get_allowlist_path()
    if os.path.exists(path):
        try:
            with open(path, "r") as f:
                return set(json.load(f))
        except (json.JSONDecodeError, TypeError):
            return set()
    return set()


def _save_allowlist(items: set[str]) -> None:
    path = _get_allowlist_path()
    with open(path, "w") as f:
        json.dump(sorted(items), f, indent=2)


def allowlist_add(value: str) -> None:
    items = _load_allowlist()
    items.add(value)
    _save_allowlist(items)


def allowlist_remove(value: str) -> None:
    items = _load_allowlist()
    items.discard(value)
    _save_allowlist(items)


def allowlist_show() -> list[str]:
    return sorted(_load_allowlist())


def allowlist_clear() -> None:
    _save_allowlist(set())


# ---------------------------------------------------------------------------
# Name Watchlist — uses DATA_DIR env var for storage
# ---------------------------------------------------------------------------

_DEFAULT_WATCHLIST = [
    # Add your own names here, or use the shield_allowlist_add MCP tool.
    # Example: "Jane Doe", "John Smith"
]


def _get_watchlist_path() -> str:
    data_dir = os.environ.get("FRIDAY_DATA_DIR", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(data_dir, ".name_watchlist.json")


def _load_watchlist() -> list[str]:
    """Load name watchlist from file, falling back to defaults."""
    path = _get_watchlist_path()
    if os.path.exists(path):
        try:
            with open(path, "r") as f:
                data = json.load(f)
                return data if isinstance(data, list) else list(_DEFAULT_WATCHLIST)
        except (json.JSONDecodeError, TypeError):
            return list(_DEFAULT_WATCHLIST)
    return list(_DEFAULT_WATCHLIST)


def _save_watchlist(names: list[str]) -> None:
    path = _get_watchlist_path()
    with open(path, "w") as f:
        json.dump(sorted(set(names)), f, indent=2)


def watchlist_add(name: str) -> None:
    """Add a name to the watchlist."""
    names = _load_watchlist()
    if name not in names:
        names.append(name)
    _save_watchlist(names)


def watchlist_remove(name: str) -> None:
    """Remove a name from the watchlist."""
    names = _load_watchlist()
    names = [n for n in names if n != name]
    _save_watchlist(names)


def watchlist_show() -> list[str]:
    """Show all names on the watchlist."""
    return sorted(_load_watchlist())


def watchlist_clear() -> None:
    """Remove all names from the watchlist."""
    _save_watchlist([])


def watchlist_reset() -> None:
    """Reset the watchlist to defaults."""
    _save_watchlist(list(_DEFAULT_WATCHLIST))


# ---------------------------------------------------------------------------
# Luhn check for credit cards
# ---------------------------------------------------------------------------

def _luhn_check(number: str) -> bool:
    digits = [int(d) for d in number if d.isdigit()]
    if len(digits) < 13 or len(digits) > 19:
        return False
    checksum = 0
    reverse_digits = digits[::-1]
    for i, d in enumerate(reverse_digits):
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        checksum += d
    return checksum % 10 == 0


# ---------------------------------------------------------------------------
# Regex patterns for each PII category
# ---------------------------------------------------------------------------

_SSN_PATTERN = re.compile(r'\b(\d{3}-\d{2}-\d{4})\b')

# Credit card: standard 4-4-4-X format + Amex 4-6-5 format
_CC_PATTERN = re.compile(
    r'\b('
    r'3[47]\d{2}[-\s]?\d{6}[-\s]?\d{5}'        # Amex: 4-6-5 grouping (starts 34 or 37)
    r'|'
    r'\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{1,7}' # Standard: 4-4-4-X (Visa/MC/Discover)
    r')\b'
)

_BANK_PATTERN = re.compile(r'(?i)\b(?:account|acct|routing|aba)[#:\s-]*(\d{6,17})\b')

_PHONE_PATTERN = re.compile(
    r'(?<!\d)'
    r'(\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4})'
    r'(?!\d)'
)

_EMAIL_PATTERN = re.compile(r'\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b')

# Physical addresses: number + street name + suffix + optional city/state/zip
# FIX: city pattern now uses [A-Z][a-z]+ to avoid consuming state abbreviation
_ADDRESS_PATTERN = re.compile(
    r'\b(\d{1,6}\s+[A-Z][a-zA-Z\s]{2,40}'
    r'(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Road|Rd|Court|Ct|Way|Place|Pl|Circle|Cir|Trail|Trl|Parkway|Pkwy)'
    r'\.?'
    r'(?:[,\s]+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)?'  # city: capitalized words only
    r'(?:[,\s]+[A-Z]{2})?'                          # state: exactly 2 uppercase
    r'(?:[,\s]+\d{5}(?:-\d{4})?)?'                  # zip: 5 digits, optional +4
    r')',
    re.MULTILINE
)

# Medical: medications, diagnoses, drug classes, insurance, providers, health terms
_MEDICAL_TERMS = [
    # --- Medications (generic) ---
    "metformin", "lisinopril", "atorvastatin", "levothyroxine", "amlodipine",
    "omeprazole", "losartan", "gabapentin", "hydrochlorothiazide", "sertraline",
    "simvastatin", "montelukast", "escitalopram", "rosuvastatin", "bupropion",
    "fluoxetine", "pantoprazole", "duloxetine", "tamsulosin", "meloxicam",
    "trazodone", "prednisone", "amoxicillin", "alprazolam", "citalopram",
    "tramadol", "ibuprofen", "acetaminophen", "oxycodone", "hydrocodone",
    "zolpidem", "cyclobenzaprine", "naproxen", "methylphenidate", "clonazepam",
    "lorazepam", "diazepam", "warfarin", "insulin", "albuterol", "metoprolol",
    "carvedilol", "furosemide", "spironolactone", "clopidogrel", "rivaroxaban",
    "apixaban", "methotrexate", "adalimumab", "humira", "ozempic", "wegovy",
    "semaglutide", "tirzepatide", "mounjaro", "adderall", "vyvanse", "ritalin",
    "xanax", "valium", "ambien", "prozac", "zoloft", "lexapro", "wellbutrin",
    "lipitor", "crestor", "nexium", "prilosec",
    # --- Drug classes ---
    "GLP-1 receptor agonist", "GLP-1 agonist", "GLP-1 medication", "GLP-1",
    "SSRI", "SNRI", "benzodiazepine", "statin", "beta blocker", "ACE inhibitor",
    "ARB", "PPI", "opioid", "stimulant", "antidepressant", "antipsychotic",
    "anticoagulant", "antihistamine", "antibiotic",
    # --- Generic medical terms ---
    "medication", "medications", "prescription", "prescriptions", "prescribed",
    "dosage", "refill", "pharmacy", "pharmacist", "diagnosis", "diagnosed",
    "prognosis", "treatment", "therapy", "therapeutic",
    # --- Insurance companies ---
    "Cigna Healthcare", "Cigna", "Aetna", "UnitedHealthcare", "UnitedHealth",
    "BlueCross BlueShield", "BlueCross", "Blue Cross Blue Shield", "Blue Cross",
    "BlueShield", "Blue Shield", "BCBS", "Humana", "Kaiser Permanente", "Kaiser",
    "Anthem", "Molina", "Centene", "WellCare", "Medicaid", "Medicare",
    "Tricare", "health insurance", "insurance plan", "insurance provider",
    # --- Medical providers / services ---
    "telehealth", "telemedicine", "Henry Meds", "Hims", "Hers", "Ro",
    "primary care", "urgent care", "emergency room",
    "therapist", "psychiatrist", "psychologist", "cardiologist", "endocrinologist",
    "dermatologist", "neurologist", "oncologist", "urologist", "gynecologist",
    "pediatrician", "radiologist", "surgeon",
    # --- Diagnoses / conditions ---
    "diabetes", "hypertension", "hyperlipidemia", "hypothyroidism",
    "depression", "anxiety", "bipolar", "schizophrenia", "adhd",
    "asthma", "copd", "pneumonia", "bronchitis",
    "cancer", "leukemia", "lymphoma", "melanoma", "carcinoma",
    "hiv", "hepatitis", "cirrhosis",
    "alzheimer", "parkinson", "epilepsy", "multiple sclerosis",
    "fibromyalgia", "lupus", "rheumatoid arthritis",
    "heart failure", "atrial fibrillation", "coronary artery disease",
    "chronic kidney disease", "dialysis",
    "type 1 diabetes", "type 2 diabetes", "gestational diabetes",
    "sleep apnea", "insomnia",
    "ptsd", "ocd", "eating disorder", "anorexia", "bulimia",
    "obesity", "chronic pain", "migraines", "irritable bowel syndrome",
    "crohn's disease", "ulcerative colitis", "celiac disease",
    "endometriosis", "pcos", "polycystic ovary syndrome",
    "osteoporosis", "arthritis", "gout",
]

# Sort by length descending so longer multi-word terms match before their substrings
_sorted_medical = sorted(_MEDICAL_TERMS, key=len, reverse=True)
_MEDICAL_PATTERN = re.compile(
    r'(?i)\b(' + '|'.join(re.escape(t) for t in _sorted_medical) + r')\b'
)

# Government IDs: passport, driver's license, and state-code DL formats
_GOV_ID_PATTERN = re.compile(
    r"(?i)(?:"
    r"(?:passport|passport\s*(?:no|number|#))[:\s#]*([A-Z0-9]{6,9})"
    r"|"
    r"(?:driver'?s?\s*license|DL|license\s*(?:no|number|#))[:\s#]*([A-Z0-9]{5,15})"
    r")"
)

# State-code prefixed DL: "TX 12345678" or "CA A1234567"
_US_STATES = (
    r'AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|'
    r'MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|'
    r'SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY'
)
_STATE_DL_PATTERN = re.compile(
    r'(?:^|(?<=\s))((?:' + _US_STATES + r')\s+[A-Z]?\d{7,9})\b',
    re.MULTILINE
)


# ---------------------------------------------------------------------------
# Scanner
# ---------------------------------------------------------------------------

def _find_ssn(text: str) -> list[tuple[int, int, str]]:
    return [(m.start(), m.end(), m.group(0)) for m in _SSN_PATTERN.finditer(text)]

def _find_credit_cards(text: str) -> list[tuple[int, int, str]]:
    results = []
    for m in _CC_PATTERN.finditer(text):
        raw = m.group(0)
        digits_only = re.sub(r'[\s-]', '', raw)
        if _luhn_check(digits_only):
            results.append((m.start(), m.end(), raw))
    return results

def _find_bank_accounts(text: str) -> list[tuple[int, int, str]]:
    return [(m.start(), m.end(), m.group(0)) for m in _BANK_PATTERN.finditer(text)]

def _find_phones(text: str) -> list[tuple[int, int, str]]:
    return [(m.start(), m.end(), m.group(0)) for m in _PHONE_PATTERN.finditer(text)]

def _find_emails(text: str) -> list[tuple[int, int, str]]:
    return [(m.start(), m.end(), m.group(0)) for m in _EMAIL_PATTERN.finditer(text)]

def _find_addresses(text: str) -> list[tuple[int, int, str]]:
    return [(m.start(), m.end(), m.group(0)) for m in _ADDRESS_PATTERN.finditer(text)]

def _find_medical(text: str) -> list[tuple[int, int, str]]:
    return [(m.start(), m.end(), m.group(0)) for m in _MEDICAL_PATTERN.finditer(text)]

def _find_gov_ids(text: str) -> list[tuple[int, int, str]]:
    results = []
    # Keyword-based patterns (passport, DL, driver's license, etc.)
    for m in _GOV_ID_PATTERN.finditer(text):
        results.append((m.start(), m.end(), m.group(0)))
    # State-code prefixed patterns (TX 12345678, CA A1234567)
    for m in _STATE_DL_PATTERN.finditer(text):
        s = m.start(1)
        e = m.end(1)
        results.append((s, e, m.group(1)))
    return results

def _find_names(text: str) -> list[tuple[int, int, str]]:
    """Find names from the watchlist in text."""
    watchlist = _load_watchlist()
    if not watchlist:
        return []
    # Sort by length descending so longer names match first
    sorted_names = sorted(watchlist, key=len, reverse=True)
    pattern = re.compile(
        r'(?i)\b(' + '|'.join(re.escape(name) for name in sorted_names) + r')\b'
    )
    return [(m.start(), m.end(), m.group(0)) for m in pattern.finditer(text)]


_SCANNERS: dict[PIICategory, callable] = {
    PIICategory.SSN: _find_ssn,
    PIICategory.CREDIT_CARD: _find_credit_cards,
    PIICategory.BANK_ACCOUNT: _find_bank_accounts,
    PIICategory.PHONE: _find_phones,
    PIICategory.EMAIL: _find_emails,
    PIICategory.ADDRESS: _find_addresses,
    PIICategory.MEDICAL: _find_medical,
    PIICategory.GOVERNMENT_ID: _find_gov_ids,
    PIICategory.NAME: _find_names,
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def scan_text(
    text: str,
    categories: Optional[list[PIICategory]] = None,
    allowlist: Optional[set[str]] = None,
) -> list[PIIMatch]:
    if categories is None:
        categories = list(PIICategory)
    if allowlist is None:
        allowlist = _load_allowlist()
    matches: list[PIIMatch] = []
    seen_spans: set[tuple[int, int]] = set()
    for cat in categories:
        scanner = _SCANNERS[cat]
        for start, end, original in scanner(text):
            if original in allowlist or original.strip() in allowlist:
                continue
            span = (start, end)
            if any(s <= start < e or s < end <= e for s, e in seen_spans):
                continue
            seen_spans.add(span)
            replacement = make_placeholder(cat, original)
            matches.append(PIIMatch(
                category=cat, original=original, replacement=replacement,
                start=start, end=end,
            ))
    matches.sort(key=lambda m: m.start)
    return matches


def scrub_text(
    text: str,
    categories: Optional[list[PIICategory]] = None,
    allowlist: Optional[set[str]] = None,
) -> tuple[str, list[PIIMatch]]:
    matches = scan_text(text, categories, allowlist)
    result = text
    for m in reversed(matches):
        result = result[:m.start] + m.replacement + result[m.end:]
    return result, matches


def unscrub_text(scrubbed: str, matches: list[PIIMatch]) -> str:
    result = scrubbed
    for m in matches:
        result = result.replace(m.replacement, m.original)
    return result
