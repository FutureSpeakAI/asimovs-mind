# Privacy Shield

A Python module that detects and masks personally identifiable information (PII) before data leaves your machine. Runs as a filter on any text sent to external APIs (Gemini, web services, etc.). Part of the [Asimov's Mind](https://github.com/FutureSpeakAI/asimovs-mind) ecosystem.

**Standalone repo:** [privacy-shield](https://github.com/FutureSpeakAI/privacy-shield)

## PII Categories

| Category | Examples |
|----------|----------|
| SSN | 123-45-6789 |
| Credit Card | 4532-0151-1283-0366 (Luhn-validated) |
| Bank Account | Account/routing numbers |
| Phone | (512) 814-7609, 512-814-7609 |
| Email | user@example.com |
| Address | 123 Main Street, Austin TX 78701 |
| Medical | Medications, diagnoses, conditions |
| Government ID | Passport, driver's license numbers |

## Quick Start

```bash
# Install
pip install -r requirements.txt

# Scan a file for PII
python cli.py scan myfile.txt

# Scrub PII from a file
python cli.py scrub myfile.txt -o clean.txt

# Scrub inline text
python cli.py scrub-text "My SSN is 123-45-6789"

# Manage allowlist
python cli.py allowlist add "stephen@friday.com"
python cli.py allowlist show
```

## Python API

```python
from shield import scan_text, scrub_text, unscrub_text, PIICategory

# Scan for all PII
matches = scan_text("My SSN is 123-45-6789")

# Scrub and get matches for later restoration
scrubbed, matches = scrub_text("Call (512) 814-7609")
# scrubbed = "Call [PHONE:a3f8b2c1e4d5f607]"

# Restore original text
original = unscrub_text(scrubbed, matches)
```

## How It Works

1. **Regex patterns** detect PII across 8 categories
2. **Luhn validation** prevents false positives on credit cards
3. **FNV-1a hashing** generates consistent, deterministic placeholders
4. **Allowlist** lets you exempt known-safe values (e.g., your public email)
5. **Round-trip** support: scrub before sending, unscrub when receiving

## Testing

```bash
pytest test_shield.py -v
```
