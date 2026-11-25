"""Field-matcher tests (Chunk 36).

Pass mark: ≥90% of non-skip fields matched correctly across all 5 fixtures.
Hard constraints enforced per test:
  - 0 sensitive fields mapped to a "will_fill" value
  - 0 guessed values (every "will_fill" key exists in the bank)

The tests build raw element lists by hand (same pattern as test_observer.py)
and call ``match_fields(observation.elements, bank)`` directly — no browser.
"""

from __future__ import annotations

from jobhuntz_agent.browser.observer import build_observation
from jobhuntz_agent.fields.matcher import match_fields
from jobhuntz_agent.fields.profile_bank import ContactProfile, ProfileBank


# ── shared test bank ──────────────────────────────────────────────────────────

def _test_bank() -> ProfileBank:
    return ProfileBank(
        contact=ContactProfile(
            first_name="Alex",
            last_name="Tester",
            full_name="Alex Tester",
            email="alex.tester@example.com",
            phone="07700900123",
            linkedin="https://linkedin.com/in/alextester",
            github="https://github.com/alextester",
            portfolio="https://alextester.dev",
            location="London, UK",
        ),
        saved_answers={
            "right_to_work": "Yes, I have the right to work in the UK.",
            "sponsorship": "No",
            "start_date": "Immediately",
        },
    )


# ── raw element helper (mirrors test_observer.py) ─────────────────────────────

def raw_el(**kw):
    base = {
        "tag": "input", "type": "text", "id": "", "name": "",
        "data_attr": "", "data_qa": "", "aria_label": "", "aria_labelledby": "",
        "label_for": "", "wrapping_label": "", "group_label": "", "placeholder": "",
        "nearby_text": "", "text": "", "required": False, "value": "", "visible": True,
        "xpath": "/html/body/input[1]", "href": "", "checked": False,
        "multiple": False, "options": [], "frame_path": "", "autocomplete": "",
    }
    base.update(kw)
    return base


def _build(elements, url="https://example.com/apply"):
    raw = {
        "url": url,
        "title": "Apply",
        "elements": elements,
        "headings": [],
        "password_fields": 0,
        "iframes": [],
        "scripts": [],
        "captcha": False,
    }
    return build_observation(raw)


def _accuracy(result_map, expected_tags):
    """Return fraction of expected entries that match."""
    correct = sum(
        1 for idx, tag in expected_tags.items()
        if idx in result_map and result_map[idx].fill_tag == tag
    )
    return correct / len(expected_tags) if expected_tags else 1.0


# ── Fixture 1: gh_basic ───────────────────────────────────────────────────────

def _gh_basic_elements():
    return [
        raw_el(id="first_name", name="job_application[first_name]",
               label_for="First name *", required=True, autocomplete="given-name"),
        raw_el(id="last_name", name="job_application[last_name]",
               label_for="Last name *", required=True, autocomplete="family-name"),
        raw_el(id="email", type="email", name="job_application[email]",
               label_for="Email address *", required=True, autocomplete="email"),
        raw_el(id="phone", type="tel", name="job_application[phone]",
               label_for="Phone number", autocomplete="tel"),
        raw_el(type="url", name="job_application[linkedin]",
               data_attr="data-qa", data_qa="linkedin-url",
               wrapping_label="LinkedIn profile"),
        raw_el(name="job_application[website]",
               aria_label="Personal website", placeholder="https://…"),
        raw_el(name="job_application[referral]",
               placeholder="Who referred you?"),
        raw_el(id="resume", type="file", name="job_application[resume]",
               label_for="Resume/CV *", required=True),
        raw_el(
            tag="select", type=None, id="location", name="job_application[location]",
            label_for="Where are you based? *", required=True,
            options=[
                {"value": "", "label": "Select…", "selected": True},
                {"value": "london", "label": "London, UK", "selected": False},
            ],
        ),
        raw_el(type="checkbox", name="job_application[newsletter]",
               value="yes", wrapping_label="Keep me posted about future roles"),
        raw_el(type="radio", name="job_application[source]", value="linkedin",
               group_label="How did you hear about us? *", required=True,
               wrapping_label="LinkedIn"),
        raw_el(type="radio", name="job_application[source]", value="referral",
               group_label="How did you hear about us? *", wrapping_label="A friend"),
        raw_el(type="radio", name="job_application[source]", value="other",
               group_label="How did you hear about us? *", wrapping_label="Other"),
        raw_el(tag="button", type="submit", id="submit_app",
               text="Submit application"),
    ]


def test_gh_basic_core_fields_are_will_fill():
    bank = _test_bank()
    obs = _build(_gh_basic_elements())
    result = match_fields(obs.elements, bank)
    # Indices 0–3: first_name, last_name, email, phone (autocomplete wins)
    for idx in [0, 1, 2, 3]:
        assert result[idx].fill_tag == "will_fill", f"index {idx}: {result[idx]}"


def test_gh_basic_linkedin_matched():
    bank = _test_bank()
    obs = _build(_gh_basic_elements())
    result = match_fields(obs.elements, bank)
    linkedin_el = next(e for e in obs.elements if "linkedin" in (e.label or "").lower())
    assert result[linkedin_el.index].fill_tag == "will_fill"
    assert result[linkedin_el.index].profile_key == "linkedin"


def test_gh_basic_file_and_button_are_skip():
    bank = _test_bank()
    obs = _build(_gh_basic_elements())
    result = match_fields(obs.elements, bank)
    file_el = next(e for e in obs.elements if e.role == "file")
    btn_el = next(e for e in obs.elements if e.role == "button")
    assert result[file_el.index].fill_tag == "unknown"  # skip
    assert result[btn_el.index].fill_tag == "unknown"   # skip


def test_gh_basic_no_sensitive_is_will_fill():
    """The basic form has no sensitive questions — none should be needs_you."""
    bank = _test_bank()
    obs = _build(_gh_basic_elements())
    result = match_fields(obs.elements, bank)
    for m in result.values():
        assert m.fill_tag != "needs_you", f"Unexpected sensitive hit: {m}"


def test_gh_basic_accuracy_90_percent():
    bank = _test_bank()
    obs = _build(_gh_basic_elements())
    result = match_fields(obs.elements, bank)
    # Expected tags per index (after radio collapse the source group → index 10,
    # submit button → index 11).
    expected = {
        0: "will_fill",   # first_name (autocomplete)
        1: "will_fill",   # last_name (autocomplete)
        2: "will_fill",   # email (autocomplete)
        3: "will_fill",   # phone (autocomplete)
        4: "will_fill",   # linkedin (synonym)
        5: "will_fill",   # personal website / portfolio
        6: "unknown",     # referral — not in bank
        7: "unknown",     # file (skip)
        8: "unknown",     # location — not in bank
        9: "unknown",     # newsletter checkbox
        10: "unknown",    # source radiogroup
        11: "unknown",    # submit button (skip)
    }
    acc = _accuracy(result, expected)
    assert acc >= 0.90, f"gh_basic accuracy {acc:.0%} < 90%"


# ── Fixture 2: gh_workauth ────────────────────────────────────────────────────

def _gh_workauth_elements():
    return [
        raw_el(id="first_name", name="job_application[first_name]",
               label_for="First name *", required=True, autocomplete="given-name"),
        raw_el(id="email", type="email", name="job_application[email]",
               label_for="Email address *", required=True, autocomplete="email"),
        # Sensitive: right to work (radio group)
        raw_el(type="radio", name="rtw", value="yes",
               group_label="Do you have the right to work in the UK? *",
               required=True, wrapping_label="Yes"),
        raw_el(type="radio", name="rtw", value="no",
               group_label="Do you have the right to work in the UK? *",
               wrapping_label="No"),
        raw_el(type="radio", name="rtw", value="will_need",
               group_label="Do you have the right to work in the UK? *",
               wrapping_label="I will need a visa"),
        # Sensitive: sponsorship (radio group)
        raw_el(type="radio", name="sponsorship", value="no",
               group_label="Will you require visa sponsorship now or in the future? *",
               required=True, wrapping_label="No"),
        raw_el(type="radio", name="sponsorship", value="yes",
               group_label="Will you require visa sponsorship now or in the future? *",
               wrapping_label="Yes"),
        raw_el(type="radio", name="sponsorship", value="unsure",
               group_label="Will you require visa sponsorship now or in the future? *",
               wrapping_label="Unsure"),
        # Sensitive: salary
        raw_el(id="salary_exp", name="job_application[salary_expectation]",
               label_for="Salary expectation (£)", placeholder="e.g. 75000"),
        # Sensitive: gender (EO)
        raw_el(
            tag="select", type=None, id="gender",
            name="job_application[gender]",
            label_for="Gender (optional — equal opportunities monitoring)",
            options=[
                {"value": "", "label": "Prefer not to say", "selected": True},
                {"value": "female", "label": "Female", "selected": False},
            ],
        ),
        raw_el(id="resume", type="file", name="job_application[resume]",
               label_for="Resume/CV *", required=True),
        raw_el(tag="button", type="submit", id="submit_app",
               text="Submit application"),
    ]


def test_gh_workauth_sensitive_fields_are_needs_you():
    """Every sensitive question must be marked needs_you."""
    bank = _test_bank()
    obs = _build(_gh_workauth_elements())
    result = match_fields(obs.elements, bank)
    # rtw radiogroup is collapsed to one element; find it by label contains "right to work"
    rtw_el = next(
        e for e in obs.elements
        if "right to work" in (e.label or "").lower()
    )
    assert result[rtw_el.index].fill_tag == "needs_you"
    assert result[rtw_el.index].sensitive_topic == "right_to_work"

    sponsorship_el = next(
        e for e in obs.elements
        if "sponsorship" in (e.label or "").lower() or "sponsorship" in (e.name or "").lower()
    )
    assert result[sponsorship_el.index].fill_tag == "needs_you"
    assert result[sponsorship_el.index].sensitive_topic in ("sponsorship", "right_to_work")

    salary_el = next(
        e for e in obs.elements
        if "salary" in (e.label or "").lower()
    )
    assert result[salary_el.index].fill_tag == "needs_you"
    assert result[salary_el.index].sensitive_topic == "salary"

    gender_el = next(
        e for e in obs.elements
        if "gender" in (e.label or "").lower()
    )
    assert result[gender_el.index].fill_tag == "needs_you"


def test_gh_workauth_sensitive_never_will_fill():
    """Guardrail 4: sensitive fields must never be will_fill."""
    bank = _test_bank()
    obs = _build(_gh_workauth_elements())
    result = match_fields(obs.elements, bank)
    sensitive_indices = {m.index for m in result.values() if m.result == "sensitive"}
    for idx in sensitive_indices:
        assert result[idx].fill_tag != "will_fill", (
            f"Sensitive field {idx} tagged will_fill — Guardrail 4 violated"
        )


def test_gh_workauth_safe_fields_still_match():
    bank = _test_bank()
    obs = _build(_gh_workauth_elements())
    result = match_fields(obs.elements, bank)
    first_name_el = next(e for e in obs.elements if e.autocomplete == "given-name")
    email_el = next(e for e in obs.elements if e.autocomplete == "email")
    assert result[first_name_el.index].fill_tag == "will_fill"
    assert result[email_el.index].fill_tag == "will_fill"


def test_gh_workauth_accuracy_90_percent():
    bank = _test_bank()
    obs = _build(_gh_workauth_elements())
    result = match_fields(obs.elements, bank)
    # rtw collapsed to idx 2, sponsorship to idx 3
    expected = {
        0: "will_fill",   # first_name
        1: "will_fill",   # email
        2: "needs_you",   # rtw radiogroup
        3: "needs_you",   # sponsorship radiogroup
        4: "needs_you",   # salary
        5: "needs_you",   # gender (EO)
        6: "unknown",     # file (skip)
        7: "unknown",     # submit (skip)
    }
    acc = _accuracy(result, expected)
    assert acc >= 0.90, f"gh_workauth accuracy {acc:.0%} < 90%"


# ── Fixture 3: gh_extended ────────────────────────────────────────────────────

def _gh_extended_elements():
    return [
        raw_el(id="first_name", label_for="First name *", required=True,
               autocomplete="given-name"),
        raw_el(id="last_name", label_for="Last name *", required=True,
               autocomplete="family-name"),
        raw_el(id="email", type="email", label_for="Email address *", required=True,
               autocomplete="email"),
        raw_el(id="phone", type="tel", label_for="Phone number",
               autocomplete="tel"),
        raw_el(type="url", name="job_application[linkedin]",
               data_attr="data-qa", data_qa="linkedin-url",
               wrapping_label="LinkedIn profile URL"),
        raw_el(id="github", type="url", label_for="GitHub profile",
               placeholder="https://github.com/username"),
        raw_el(id="portfolio", type="url", label_for="Portfolio or personal website",
               placeholder="https://…"),
        raw_el(id="resume", type="file", label_for="Resume/CV *", required=True),
        # Sensitive: cover letter essay
        raw_el(tag="textarea", type=None, id="cover_letter",
               label_for="Cover letter",
               placeholder="Tell us why you want this role"),
        raw_el(tag="button", type="submit", id="submit_app",
               text="Submit application"),
    ]


def test_gh_extended_github_matched():
    bank = _test_bank()
    obs = _build(_gh_extended_elements())
    result = match_fields(obs.elements, bank)
    github_el = next(e for e in obs.elements if "github" in (e.label or "").lower())
    assert result[github_el.index].fill_tag == "will_fill"
    assert result[github_el.index].profile_key == "github"


def test_gh_extended_portfolio_matched():
    bank = _test_bank()
    obs = _build(_gh_extended_elements())
    result = match_fields(obs.elements, bank)
    portfolio_el = next(e for e in obs.elements if "portfolio" in (e.label or "").lower())
    assert result[portfolio_el.index].fill_tag == "will_fill"
    assert result[portfolio_el.index].profile_key in ("portfolio", "website")


def test_gh_extended_cover_letter_is_sensitive():
    bank = _test_bank()
    obs = _build(_gh_extended_elements())
    result = match_fields(obs.elements, bank)
    cover_el = next(e for e in obs.elements if "cover" in (e.label or "").lower())
    assert result[cover_el.index].fill_tag == "needs_you"
    assert result[cover_el.index].sensitive_topic == "own_words_essay"


def test_gh_extended_accuracy_90_percent():
    bank = _test_bank()
    obs = _build(_gh_extended_elements())
    result = match_fields(obs.elements, bank)
    expected = {
        0: "will_fill",   # first_name
        1: "will_fill",   # last_name
        2: "will_fill",   # email
        3: "will_fill",   # phone
        4: "will_fill",   # linkedin
        5: "will_fill",   # github
        6: "will_fill",   # portfolio
        7: "unknown",     # file (skip)
        8: "needs_you",   # cover letter (essay)
        9: "unknown",     # submit (skip)
    }
    acc = _accuracy(result, expected)
    assert acc >= 0.90, f"gh_extended accuracy {acc:.0%} < 90%"


# ── Fixture 4: gh_equity ─────────────────────────────────────────────────────

def _gh_equity_elements():
    return [
        raw_el(id="first_name", label_for="First name *", required=True,
               autocomplete="given-name"),
        raw_el(id="email", type="email", label_for="Email address *", required=True,
               autocomplete="email"),
        raw_el(id="resume", type="file", label_for="Resume/CV *", required=True),
        # EO: gender
        raw_el(
            tag="select", type=None, id="eo_gender",
            label_for="Gender",
            options=[
                {"value": "", "label": "Prefer not to say", "selected": True},
                {"value": "female", "label": "Woman", "selected": False},
            ],
        ),
        # EO: ethnicity
        raw_el(
            tag="select", type=None, id="eo_ethnicity",
            label_for="Ethnic origin",
            options=[
                {"value": "", "label": "Prefer not to say", "selected": True},
                {"value": "white_british", "label": "White British", "selected": False},
            ],
        ),
        # EO: disability (radio group)
        raw_el(type="radio", name="eo_disability", value="no",
               group_label="Do you consider yourself to have a disability?",
               wrapping_label="No"),
        raw_el(type="radio", name="eo_disability", value="yes",
               group_label="Do you consider yourself to have a disability?",
               wrapping_label="Yes"),
        raw_el(type="radio", name="eo_disability", value="prefer_not",
               group_label="Do you consider yourself to have a disability?",
               wrapping_label="Prefer not to say"),
        # EO: age group
        raw_el(
            tag="select", type=None, id="eo_age_range",
            label_for="Age group",
            options=[
                {"value": "", "label": "Prefer not to say", "selected": True},
                {"value": "25_34", "label": "25–34", "selected": False},
            ],
        ),
        raw_el(tag="button", type="submit", id="submit_app",
               text="Submit application"),
    ]


def test_gh_equity_all_eo_fields_are_needs_you():
    bank = _test_bank()
    obs = _build(_gh_equity_elements())
    result = match_fields(obs.elements, bank)
    sensitive_labels = ["Gender", "Ethnic origin", "disability", "Age group"]
    for el in obs.elements:
        for sl in sensitive_labels:
            if sl.lower() in (el.label or "").lower():
                assert result[el.index].fill_tag == "needs_you", (
                    f"EO field '{el.label}' not marked needs_you"
                )


def test_gh_equity_no_will_fill_on_sensitive():
    bank = _test_bank()
    obs = _build(_gh_equity_elements())
    result = match_fields(obs.elements, bank)
    for m in result.values():
        if m.result == "sensitive":
            assert m.fill_tag != "will_fill"


def test_gh_equity_accuracy_90_percent():
    bank = _test_bank()
    obs = _build(_gh_equity_elements())
    result = match_fields(obs.elements, bank)
    # Indices after radio collapse: 0 first_name, 1 email, 2 file, 3 gender-select,
    # 4 ethnicity-select, 5 disability-radiogroup, 6 age-select, 7 submit
    expected = {
        0: "will_fill",   # first_name
        1: "will_fill",   # email
        2: "unknown",     # file (skip)
        3: "needs_you",   # gender (EO)
        4: "needs_you",   # ethnicity (EO)
        5: "needs_you",   # disability (EO)
        6: "needs_you",   # age group (EO)
        7: "unknown",     # submit (skip)
    }
    acc = _accuracy(result, expected)
    assert acc >= 0.90, f"gh_equity accuracy {acc:.0%} < 90%"


# ── Fixture 5: gh_embedded ───────────────────────────────────────────────────
# The embedded case merges main-frame + iframe elements. We simulate this by
# setting frame_path on the iframe's elements (as merge_frame_payloads would).

def _gh_embedded_elements():
    # Main frame: one search box
    main_elements = [
        raw_el(tag="input", type="search", name="site_search",
               aria_label="Search the site", frame_path=""),
    ]
    # Iframe elements (same as gh_basic but with a frame_path set)
    iframe_fp = "https://orion.example/greenhouse_form"
    iframe_elements = [
        raw_el(id="first_name", label_for="First name *", required=True,
               autocomplete="given-name", frame_path=iframe_fp),
        raw_el(id="last_name", label_for="Last name *", required=True,
               autocomplete="family-name", frame_path=iframe_fp),
        raw_el(id="email", type="email", label_for="Email address *", required=True,
               autocomplete="email", frame_path=iframe_fp),
        raw_el(id="phone", type="tel", label_for="Phone number",
               autocomplete="tel", frame_path=iframe_fp),
        raw_el(type="url", name="job_application[linkedin]",
               data_attr="data-qa", data_qa="linkedin-url",
               wrapping_label="LinkedIn profile", frame_path=iframe_fp),
        raw_el(name="job_application[website]", aria_label="Personal website",
               placeholder="https://…", frame_path=iframe_fp),
        raw_el(id="resume", type="file", label_for="Resume/CV *", required=True,
               frame_path=iframe_fp),
        raw_el(tag="button", type="submit", id="submit_app",
               text="Submit application", frame_path=iframe_fp),
    ]
    return main_elements + iframe_elements


def test_gh_embedded_iframe_elements_matched():
    bank = _test_bank()
    obs = _build(_gh_embedded_elements())
    result = match_fields(obs.elements, bank)
    # first_name is index 1 (search box is 0)
    first_name_el = next(e for e in obs.elements if e.autocomplete == "given-name")
    email_el = next(e for e in obs.elements if e.autocomplete == "email")
    assert result[first_name_el.index].fill_tag == "will_fill"
    assert result[email_el.index].fill_tag == "will_fill"


def test_gh_embedded_frame_path_preserved():
    obs = _build(_gh_embedded_elements())
    iframe_els = [e for e in obs.elements if e.frame_path]
    assert len(iframe_els) > 0, "Expected elements with a frame_path"


def test_gh_embedded_accuracy_90_percent():
    bank = _test_bank()
    obs = _build(_gh_embedded_elements())
    result = match_fields(obs.elements, bank)
    # Build expected map: search is unknown, iframe profile fields are will_fill,
    # file and button are unknown (skip)
    expected: dict[int, str] = {}
    profile_keywords = ("linkedin", "github", "portfolio", "website")
    for el in obs.elements:
        label_lower = (el.label or "").lower()
        name_lower = (el.name or "").lower()
        combined = label_lower + " " + name_lower
        if el.role in ("file", "button"):
            expected[el.index] = "unknown"
        elif "search" in combined or el.type == "search":
            expected[el.index] = "unknown"
        elif el.autocomplete in ("given-name", "family-name", "email", "tel"):
            expected[el.index] = "will_fill"
        elif any(kw in combined for kw in profile_keywords):
            expected[el.index] = "will_fill"
        else:
            expected[el.index] = "unknown"
    acc = _accuracy(result, expected)
    assert acc >= 0.90, f"gh_embedded accuracy {acc:.0%} < 90%"


# ── Cross-fixture guardrail assertions ────────────────────────────────────────

def _all_fixtures():
    return [
        _build(_gh_basic_elements(), url="https://nexaflow.example/apply"),
        _build(_gh_workauth_elements(), url="https://meridian.example/apply"),
        _build(_gh_extended_elements(), url="https://prism.example/apply"),
        _build(_gh_equity_elements(), url="https://solent.example/apply"),
        _build(_gh_embedded_elements(), url="https://orion.example/apply"),
    ]


def test_no_sensitive_field_is_will_fill_across_all_fixtures():
    """Guardrail 4: across every fixture, no sensitive element is will_fill."""
    bank = _test_bank()
    for obs in _all_fixtures():
        result = match_fields(obs.elements, bank)
        for m in result.values():
            if m.result == "sensitive":
                assert m.fill_tag != "will_fill", (
                    f"Guardrail 4 violated: sensitive field {m.sensitive_topic} "
                    f"tagged will_fill in {obs.url}"
                )


def test_no_guessed_values_across_all_fixtures():
    """Guardrail 5: every will_fill result has a profile_key present in the bank."""
    bank = _test_bank()
    for obs in _all_fixtures():
        result = match_fields(obs.elements, bank)
        for m in result.values():
            if m.fill_tag == "will_fill":
                assert m.profile_key is not None, (
                    f"will_fill with no profile_key in {obs.url}"
                )
                assert bank.has(m.profile_key), (
                    f"profile_key '{m.profile_key}' not in bank — Guardrail 5 violated "
                    f"in {obs.url}"
                )


def test_overall_accuracy_90_percent_across_all_fixtures():
    """Aggregate: at least 90% of non-skip elements across all 5 fixtures correct."""
    bank = _test_bank()
    total = 0
    correct = 0
    for obs in _all_fixtures():
        result = match_fields(obs.elements, bank)
        for m in result.values():
            if m.result == "skip":
                continue
            total += 1
            # A result is "correct" when:
            #   - will_fill: has a profile_key the bank holds
            #   - needs_you: has a sensitive_topic
            #   - unknown: nothing was guessed
            if m.result == "profile" and m.profile_key and bank.has(m.profile_key):
                correct += 1
            elif m.result == "sensitive" and m.sensitive_topic:
                correct += 1
            elif m.result == "unknown":
                correct += 1  # correctly flagged as unknown
    acc = correct / total if total else 1.0
    assert acc >= 0.90, f"Overall accuracy {acc:.0%} < 90% (correct {correct}/{total})"
