"""Greenhouse adapter tests (Chunk 37).

Uses FakePage — a pure-Python test double with the same API as a Playwright
Page — so no real browser is needed.  One test class per fixture.

Pass criteria:
  - Every ``will_fill`` field gets the correct bank value.
  - Sensitive / unknown fields stay empty (the FakePage never receives a
    ``fill`` / ``select_option`` / ``check`` call for them).
  - File inputs get the correct path via ``set_input_files``.
  - The submit button is never clicked.
  - The iframe variant routes fills to the right frame.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import pytest

from jobhuntz_agent.adapters.greenhouse import FillResult, detect, fill
from jobhuntz_agent.browser.observer import build_observation
from jobhuntz_agent.fields.profile_bank import ContactProfile, ProfileBank


# ── FakePage double ───────────────────────────────────────────────────────────

class FakePage:
    """Records every Playwright-shaped call without a real browser.

    ``frames`` is a list of child FakePages (not including self — matching
    how the adapter calls ``_get_frame``: frame_path="" → returns the page
    itself, frame_path=url → iterates frames to find a matching child).
    """

    def __init__(self, url: str = "", frames: Optional[list["FakePage"]] = None):
        self._url = url
        self._frames: list["FakePage"] = frames or []
        # Filled text / textarea
        self.filled: dict[str, str] = {}
        # Selected option (by label or value)
        self.selected: dict[str, str] = {}
        # Checked checkboxes / radios
        self.checked: list[str] = []
        self.unchecked: list[str] = []
        # File uploads
        self.files: dict[str, str] = {}
        # Any click (should stay empty)
        self.clicks: list[str] = []

    @property
    def url(self) -> str:
        return self._url

    @property
    def frames(self) -> list["FakePage"]:
        return self._frames

    def fill(self, selector: str, value: str, **kw) -> None:
        self.filled[selector] = value

    def select_option(
        self,
        selector: str,
        *,
        value: Optional[str] = None,
        label: Optional[str] = None,
        **kw,
    ) -> None:
        self.selected[selector] = label if label is not None else value  # type: ignore[assignment]

    def check(self, selector: str, **kw) -> None:
        self.checked.append(selector)

    def uncheck(self, selector: str, **kw) -> None:
        self.unchecked.append(selector)

    def set_input_files(self, selector: str, files: object, **kw) -> None:
        self.files[selector] = str(files)

    def click(self, selector: str, **kw) -> None:
        self.clicks.append(selector)


# ── Shared helpers ────────────────────────────────────────────────────────────

def _bank() -> ProfileBank:
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


def raw_el(**kw) -> dict:
    """Build a raw element dict (same defaults as test_field_matcher.py)."""
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


def _build(elements: list[dict], url: str = "https://boards.greenhouse.io/acme/jobs/123"):
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


# ── Fixture 1: gh_basic ───────────────────────────────────────────────────────

def _gh_basic_elements(frame_path: str = "") -> list[dict]:
    return [
        raw_el(id="first_name", name="job_application[first_name]",
               label_for="First name *", required=True,
               autocomplete="given-name", frame_path=frame_path),
        raw_el(id="last_name", name="job_application[last_name]",
               label_for="Last name *", required=True,
               autocomplete="family-name", frame_path=frame_path),
        raw_el(id="email", type="email", name="job_application[email]",
               label_for="Email address *", required=True,
               autocomplete="email", frame_path=frame_path),
        raw_el(id="phone", type="tel", name="job_application[phone]",
               label_for="Phone number", autocomplete="tel",
               frame_path=frame_path),
        raw_el(type="url", name="job_application[linkedin]",
               data_attr="data-qa", data_qa="linkedin-url",
               wrapping_label="LinkedIn profile", frame_path=frame_path),
        raw_el(name="job_application[website]",
               aria_label="Personal website",
               placeholder="https://…", frame_path=frame_path),
        raw_el(name="job_application[referral]",
               placeholder="Who referred you?", frame_path=frame_path),
        raw_el(id="resume", type="file", name="job_application[resume]",
               label_for="Resume/CV *", required=True, frame_path=frame_path),
        raw_el(
            tag="select", type=None, id="location",
            name="job_application[location]",
            label_for="Where are you based? *", required=True,
            frame_path=frame_path,
            options=[
                {"value": "", "label": "Select…", "selected": True},
                {"value": "london", "label": "London, UK", "selected": False},
                {"value": "remote_uk", "label": "Remote (UK)", "selected": False},
            ],
        ),
        raw_el(type="checkbox", name="job_application[newsletter]",
               value="yes", wrapping_label="Keep me posted about future roles",
               frame_path=frame_path),
        raw_el(type="radio", name="job_application[source]", value="linkedin",
               group_label="How did you hear about us? *", required=True,
               wrapping_label="LinkedIn", frame_path=frame_path),
        raw_el(type="radio", name="job_application[source]", value="referral",
               group_label="How did you hear about us? *",
               wrapping_label="A friend", frame_path=frame_path),
        raw_el(type="radio", name="job_application[source]", value="other",
               group_label="How did you hear about us? *",
               wrapping_label="Other", frame_path=frame_path),
        raw_el(tag="button", type="submit", id="submit_app",
               text="Submit application", frame_path=frame_path),
    ]


class TestGhBasic:
    def _run(self, tmp_path: Path) -> tuple[FakePage, FillResult]:
        cv = tmp_path / "cv.pdf"
        cv.write_bytes(b"%PDF-1.4 fake")
        page = FakePage(url="https://boards.greenhouse.io/acme/jobs/123")
        obs = _build(_gh_basic_elements())
        result = fill(page, obs, _bank(), cv_path=cv)
        return page, result

    def test_core_text_fields_filled(self, tmp_path: Path):
        page, _ = self._run(tmp_path)
        assert page.filled["#first_name"] == "Alex"
        assert page.filled["#last_name"] == "Tester"
        assert page.filled["#email"] == "alex.tester@example.com"
        assert page.filled["#phone"] == "07700900123"

    def test_linkedin_filled(self, tmp_path: Path):
        page, _ = self._run(tmp_path)
        assert page.filled['input[name="job_application[linkedin]"]'] == (
            "https://linkedin.com/in/alextester"
        )

    def test_personal_website_filled_as_portfolio(self, tmp_path: Path):
        # aria-label "Personal website" → "portfolio" key → alextester.dev
        page, _ = self._run(tmp_path)
        assert page.filled['input[name="job_application[website]"]'] == (
            "https://alextester.dev"
        )

    def test_location_combobox_selected(self, tmp_path: Path):
        page, _ = self._run(tmp_path)
        # Adapter selects by label
        assert page.selected["#location"] == "London, UK"

    def test_cv_uploaded(self, tmp_path: Path):
        page, result = self._run(tmp_path)
        assert result.cv_uploaded is True
        assert result.cv_field_found is True
        # set_input_files was called on the resume field
        assert "#resume" in page.files

    def test_submit_never_clicked(self, tmp_path: Path):
        page, _ = self._run(tmp_path)
        assert page.clicks == [], f"submit was clicked: {page.clicks}"

    def test_referral_and_newsletter_not_filled(self, tmp_path: Path):
        page, result = self._run(tmp_path)
        assert 'input[name="job_application[referral]"]' not in page.filled
        assert 'input[name="job_application[newsletter]"]' not in page.filled
        assert 'input[name="job_application[newsletter]"]' not in page.checked

    def test_counts_sane(self, tmp_path: Path):
        _, result = self._run(tmp_path)
        # first_name, last_name, email, phone, linkedin, portfolio, location = 7 filled
        assert result.filled == 7
        assert result.needs_you == 0  # no sensitive fields in gh_basic

    def test_detect_by_url(self):
        obs = _build(_gh_basic_elements())
        assert detect("https://boards.greenhouse.io/acme/jobs/123", obs) is True

    def test_detect_by_field_name(self):
        obs = _build(_gh_basic_elements())
        assert detect("https://careers.example.com/apply", obs) is True


# ── Fixture 2: gh_workauth ────────────────────────────────────────────────────

class TestGhWorkauth:
    def _elements(self) -> list[dict]:
        return [
            raw_el(id="first_name", name="job_application[first_name]",
                   label_for="First name *", required=True,
                   autocomplete="given-name"),
            raw_el(id="email", type="email", name="job_application[email]",
                   label_for="Email address *", required=True,
                   autocomplete="email"),
            # Sensitive: right to work
            raw_el(type="radio", name="rtw", value="yes",
                   group_label="Do you have the right to work in the UK? *",
                   required=True, wrapping_label="Yes"),
            raw_el(type="radio", name="rtw", value="no",
                   group_label="Do you have the right to work in the UK? *",
                   wrapping_label="No"),
            raw_el(type="radio", name="rtw", value="will_need",
                   group_label="Do you have the right to work in the UK? *",
                   wrapping_label="I will need a visa"),
            # Sensitive: sponsorship
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
                    {"value": "male", "label": "Male", "selected": False},
                ],
            ),
            raw_el(id="resume", type="file", name="job_application[resume]",
                   label_for="Resume/CV *", required=True),
            raw_el(tag="button", type="submit", id="submit_app",
                   text="Submit application"),
        ]

    def _run(self, tmp_path: Path) -> tuple[FakePage, FillResult]:
        cv = tmp_path / "cv.pdf"
        cv.write_bytes(b"%PDF-1.4 fake")
        page = FakePage(url="https://boards.greenhouse.io/meridian/jobs/456")
        obs = _build(self._elements())
        result = fill(page, obs, _bank(), cv_path=cv)
        return page, result

    def test_safe_fields_filled(self, tmp_path: Path):
        page, _ = self._run(tmp_path)
        assert page.filled["#first_name"] == "Alex"
        assert page.filled["#email"] == "alex.tester@example.com"

    def test_sensitive_fields_never_filled(self, tmp_path: Path):
        page, result = self._run(tmp_path)
        # None of the sensitive selectors should be in filled / selected / checked
        assert 'input[name="rtw"]' not in page.filled
        assert 'input[name="sponsorship"]' not in page.filled
        assert "#salary_exp" not in page.filled
        assert "#gender" not in page.selected
        # No radio was checked
        for sel in page.checked:
            assert "rtw" not in sel, f"rtw radio was checked: {sel}"
            assert "sponsorship" not in sel, f"sponsorship radio was checked: {sel}"

    def test_sensitive_count(self, tmp_path: Path):
        _, result = self._run(tmp_path)
        # rtw group, sponsorship group, salary, gender = 4 sensitive
        assert result.needs_you == 4

    def test_cv_uploaded(self, tmp_path: Path):
        page, result = self._run(tmp_path)
        assert result.cv_uploaded is True
        assert "#resume" in page.files

    def test_submit_never_clicked(self, tmp_path: Path):
        page, _ = self._run(tmp_path)
        assert page.clicks == []


# ── Fixture 3: gh_extended ────────────────────────────────────────────────────

class TestGhExtended:
    def _elements(self) -> list[dict]:
        return [
            raw_el(id="first_name", name="job_application[first_name]",
                   label_for="First name *", required=True,
                   autocomplete="given-name"),
            raw_el(id="last_name", name="job_application[last_name]",
                   label_for="Last name *", required=True,
                   autocomplete="family-name"),
            raw_el(id="email", type="email", name="job_application[email]",
                   label_for="Email address *", required=True,
                   autocomplete="email"),
            raw_el(id="phone", type="tel", name="job_application[phone]",
                   label_for="Phone number", autocomplete="tel"),
            raw_el(type="url", name="job_application[linkedin]",
                   data_attr="data-qa", data_qa="linkedin-url",
                   wrapping_label="LinkedIn profile URL"),
            raw_el(id="github", type="url", name="job_application[github]",
                   label_for="GitHub profile",
                   placeholder="https://github.com/username"),
            raw_el(id="portfolio", type="url", name="job_application[portfolio]",
                   label_for="Portfolio or personal website",
                   placeholder="https://…"),
            raw_el(id="resume", type="file", name="job_application[resume]",
                   label_for="Resume/CV *", required=True),
            # Sensitive: cover letter essay
            raw_el(tag="textarea", id="cover_letter",
                   name="job_application[cover_letter]",
                   label_for="Cover letter",
                   placeholder="Tell us why you want this role"),
            raw_el(tag="button", type="submit", id="submit_app",
                   text="Submit application"),
        ]

    def _run(self, tmp_path: Path) -> tuple[FakePage, FillResult]:
        cv = tmp_path / "cv.pdf"
        cv.write_bytes(b"%PDF-1.4 fake")
        letter = tmp_path / "letter.pdf"
        letter.write_bytes(b"%PDF-1.4 letter")
        page = FakePage(url="https://boards.greenhouse.io/prism/jobs/789")
        obs = _build(self._elements())
        result = fill(page, obs, _bank(), cv_path=cv, letter_path=letter)
        return page, result

    def test_github_filled(self, tmp_path: Path):
        page, _ = self._run(tmp_path)
        assert page.filled["#github"] == "https://github.com/alextester"

    def test_portfolio_filled(self, tmp_path: Path):
        page, _ = self._run(tmp_path)
        assert page.filled["#portfolio"] == "https://alextester.dev"

    def test_cover_letter_not_filled(self, tmp_path: Path):
        # Cover letter is a sensitive own-words essay — never answered.
        page, result = self._run(tmp_path)
        assert "#cover_letter" not in page.filled
        assert result.needs_you >= 1

    def test_cv_uploaded_letter_is_textarea(self, tmp_path: Path):
        # gh_extended has a cover-letter *textarea* (sensitive / needs_you),
        # not a file input — so only the CV file field triggers an upload.
        page, result = self._run(tmp_path)
        assert result.cv_uploaded is True
        assert result.letter_uploaded is False  # textarea, not a file input
        assert "#resume" in page.files

    def test_submit_never_clicked(self, tmp_path: Path):
        page, _ = self._run(tmp_path)
        assert page.clicks == []


# ── Fixture 4: gh_equity ─────────────────────────────────────────────────────

class TestGhEquity:
    def _elements(self) -> list[dict]:
        return [
            raw_el(id="first_name", name="job_application[first_name]",
                   label_for="First name *", required=True,
                   autocomplete="given-name"),
            raw_el(id="email", type="email", name="job_application[email]",
                   label_for="Email address *", required=True,
                   autocomplete="email"),
            raw_el(id="resume", type="file", name="job_application[resume]",
                   label_for="Resume/CV *", required=True),
            # EO sensitive fields
            raw_el(
                tag="select", type=None, id="eo_gender",
                name="job_application[eo_gender]",
                label_for="Gender",
                options=[
                    {"value": "", "label": "Prefer not to say", "selected": True},
                    {"value": "female", "label": "Woman", "selected": False},
                ],
            ),
            raw_el(
                tag="select", type=None, id="eo_ethnicity",
                name="job_application[eo_ethnicity]",
                label_for="Ethnic origin",
                options=[
                    {"value": "", "label": "Prefer not to say", "selected": True},
                ],
            ),
            raw_el(type="radio", name="eo_disability", value="no",
                   group_label="Do you consider yourself to have a disability?",
                   wrapping_label="No"),
            raw_el(type="radio", name="eo_disability", value="yes",
                   group_label="Do you consider yourself to have a disability?",
                   wrapping_label="Yes"),
            raw_el(type="radio", name="eo_disability", value="prefer_not",
                   group_label="Do you consider yourself to have a disability?",
                   wrapping_label="Prefer not to say"),
            raw_el(
                tag="select", type=None, id="eo_age_range",
                name="job_application[eo_age_range]",
                label_for="Age group",
                options=[
                    {"value": "", "label": "Prefer not to say", "selected": True},
                    {"value": "25_34", "label": "25–34", "selected": False},
                ],
            ),
            raw_el(tag="button", type="submit", id="submit_app",
                   text="Submit application"),
        ]

    def _run(self, tmp_path: Path) -> tuple[FakePage, FillResult]:
        cv = tmp_path / "cv.pdf"
        cv.write_bytes(b"%PDF-1.4 fake")
        page = FakePage(url="https://boards.greenhouse.io/solent/jobs/999")
        obs = _build(self._elements())
        result = fill(page, obs, _bank(), cv_path=cv)
        return page, result

    def test_safe_fields_filled(self, tmp_path: Path):
        page, _ = self._run(tmp_path)
        assert page.filled["#first_name"] == "Alex"
        assert page.filled["#email"] == "alex.tester@example.com"

    def test_all_eo_fields_untouched(self, tmp_path: Path):
        page, result = self._run(tmp_path)
        # None of the EO selectors appear in any fill/select/check record.
        eo_selectors = {"#eo_gender", "#eo_ethnicity", "#eo_age_range",
                        'input[name="eo_disability"]'}
        for sel in eo_selectors:
            assert sel not in page.filled, f"{sel} was filled"
            assert sel not in page.selected, f"{sel} was selected"
        for checked_sel in page.checked:
            assert "eo_disability" not in checked_sel

    def test_all_eo_counted_as_needs_you(self, tmp_path: Path):
        _, result = self._run(tmp_path)
        # gender, ethnicity, disability group, age_range = 4 sensitive
        assert result.needs_you == 4

    def test_submit_never_clicked(self, tmp_path: Path):
        page, _ = self._run(tmp_path)
        assert page.clicks == []


# ── Fixture 5: gh_embedded (iframe) ──────────────────────────────────────────

class TestGhEmbedded:
    """The host page has a site-search input in the main frame and the full
    Greenhouse form inside an iframe.  Fills must land on the right frame."""

    IFRAME_URL = "http://localhost:8765/gh_basic.html"
    HOST_URL = "http://localhost:8765/gh_embedded.html"

    def _obs(self) -> object:
        # Main-frame element: search input (unknown → not filled)
        main_els = [
            raw_el(type="search", name="site_search",
                   aria_label="Search the site", frame_path=""),
        ]
        # iframe elements: the gh_basic form, with frame_path pointing to iframe
        iframe_els = _gh_basic_elements(frame_path=self.IFRAME_URL)
        return _build(main_els + iframe_els, url=self.HOST_URL)

    def _run(self, tmp_path: Path) -> tuple[FakePage, FakePage, FillResult]:
        cv = tmp_path / "cv.pdf"
        cv.write_bytes(b"%PDF-1.4 fake")
        iframe = FakePage(url=self.IFRAME_URL)
        page = FakePage(url=self.HOST_URL, frames=[iframe])
        obs = self._obs()
        result = fill(page, obs, _bank(), cv_path=cv)
        return page, iframe, result

    def test_safe_fields_go_to_iframe(self, tmp_path: Path):
        page, iframe, _ = self._run(tmp_path)
        # Text fills go to the iframe FakePage, not the host page
        assert "#first_name" not in page.filled, "first_name filled on host page"
        assert iframe.filled.get("#first_name") == "Alex"
        assert iframe.filled.get("#email") == "alex.tester@example.com"

    def test_host_search_not_filled(self, tmp_path: Path):
        page, iframe, _ = self._run(tmp_path)
        assert 'input[name="site_search"]' not in page.filled
        assert 'input[name="site_search"]' not in iframe.filled

    def test_cv_uploaded_to_iframe(self, tmp_path: Path):
        page, iframe, result = self._run(tmp_path)
        assert result.cv_uploaded is True
        assert "#resume" in iframe.files
        assert "#resume" not in page.files

    def test_submit_never_clicked_anywhere(self, tmp_path: Path):
        page, iframe, _ = self._run(tmp_path)
        assert page.clicks == []
        assert iframe.clicks == []

    def test_location_selected_in_iframe(self, tmp_path: Path):
        _, iframe, _ = self._run(tmp_path)
        assert iframe.selected.get("#location") == "London, UK"


# ── detect() edge cases ───────────────────────────────────────────────────────

class TestDetect:
    def test_greenhouse_io_url(self):
        from jobhuntz_agent.browser.observer import PageObservation
        obs = PageObservation(url="https://boards.greenhouse.io/acme/jobs/1")
        assert detect("https://boards.greenhouse.io/acme/jobs/1", obs) is True

    def test_grnh_short_url(self):
        from jobhuntz_agent.browser.observer import PageObservation
        obs = PageObservation(url="https://grnh.se/abc123def")
        assert detect("https://grnh.se/abc123def", obs) is True

    def test_non_greenhouse_url_no_fields(self):
        from jobhuntz_agent.browser.observer import PageObservation
        obs = PageObservation(url="https://apply.example.com/apply")
        assert detect("https://apply.example.com/apply", obs) is False

    def test_non_greenhouse_url_with_gh_fields(self):
        obs = _build([
            raw_el(name="job_application[first_name]", label_for="First name"),
        ], url="https://careers.example.com/apply")
        assert detect("https://careers.example.com/apply", obs) is True


# ── FillResult.summary() ─────────────────────────────────────────────────────

class TestFillResultSummary:
    def test_typical(self):
        r = FillResult(filled=14, needs_you=2, unknown=0,
                       cv_uploaded=True, cv_field_found=True)
        # total = 14+2+0+1 = 17; filled = 14+1 = 15; needs = 2+(1-1) = 2
        assert r.summary() == "Filled 15 of 17 fields. 2 need you."

    def test_no_cv_found(self):
        r = FillResult(filled=5, needs_you=1, unknown=0,
                       cv_uploaded=False, cv_field_found=False)
        assert r.summary() == "Filled 5 of 6 fields. 1 need you."

    def test_cv_field_found_no_path(self):
        # cv_field_found but cv_uploaded=False → needs_you += 1
        r = FillResult(filled=5, needs_you=0, unknown=0,
                       cv_uploaded=False, cv_field_found=True)
        assert r.summary() == "Filled 5 of 6 fields. 1 need you."
