"""Synonym tables for field matching (Chunk 36).

No PyYAML — plain Python dicts so the module is import-free and runs under
node:test via pytest with no extra dependencies.

``AUTOCOMPLETE_TO_KEY`` maps the HTML autocomplete token to our internal
contact key.  Keys are lower-cased tokens; matching is exact.

``LABEL_SYNONYMS`` maps each contact key to a list of label fragments that,
when found as a whole word or phrase in the field's normalised label, mean "this
field is asking for that value".  Matching is case-insensitive and uses a word-
boundary regex so "phone" does not match "smartphone".
"""

from __future__ import annotations

# ── autocomplete → contact key ────────────────────────────────────────────────
# https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#attr-fe-autocomplete
AUTOCOMPLETE_TO_KEY: dict[str, str] = {
    "given-name": "first_name",
    "additional-name": "middle_name",
    "family-name": "last_name",
    "name": "full_name",
    "email": "email",
    "tel": "phone",
    "tel-national": "phone",
    "tel-local": "phone",
    "url": "website",
    "organization": "company",
    "street-address": "address",
    "address-line1": "address",
    "address-line2": "address",
    "address-level2": "city",
    "address-level1": "region",
    "postal-code": "postcode",
    "country": "country",
    "country-name": "country",
    "bday": "date_of_birth",
    "bday-day": "date_of_birth",
    "bday-month": "date_of_birth",
    "bday-year": "date_of_birth",
    "sex": "gender",
    "honorific-prefix": "title",
    "honorific-suffix": "title",
    "new-password": "password",
    "current-password": "password",
    "username": "username",
    "nickname": "username",
}

# ── contact key → label fragments ─────────────────────────────────────────────
# Every fragment should be a whole phrase (spaces allowed). Matching is a
# word-boundary search, so "first" matches "first name" but not "firstname".
LABEL_SYNONYMS: dict[str, list[str]] = {
    "first_name": [
        "first name", "first", "given name", "forename", "christian name",
        "prénom",
    ],
    "last_name": [
        "last name", "last", "surname", "family name", "second name",
        "nom de famille",
    ],
    "full_name": [
        "full name", "your name", "name", "full legal name",
    ],
    "email": [
        "email", "e-mail", "email address", "work email", "personal email",
    ],
    "phone": [
        "phone", "telephone", "mobile", "cell", "phone number",
        "mobile number", "contact number", "tel",
    ],
    "linkedin": [
        "linkedin", "linkedin profile", "linkedin url", "linkedin profile url",
    ],
    "github": [
        "github", "github profile", "github url", "github username",
        "github account",
    ],
    "portfolio": [
        "portfolio", "portfolio url", "personal website", "website",
        "personal site", "personal portfolio", "online portfolio",
    ],
    "location": [
        "location", "where are you based", "city", "current location",
        "home location",
    ],
    "address": [
        "address", "street address", "home address", "postal address",
    ],
    "postcode": [
        "postcode", "postal code", "zip code", "zip",
    ],
    "country": [
        "country", "country of residence",
    ],
    "referral": [
        "referral", "referred by", "who referred", "how did you hear",
        "how did you find", "source", "how did you hear about us",
        "how did you find out",
    ],
}
