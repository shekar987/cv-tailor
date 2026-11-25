"""The observer against the real HTML fixtures, through a real browser.

Skipped automatically where Playwright (or its Chromium) is not installed — so
it is a no-op in a bare CI but runs end to end under ``uv run pytest`` on a
machine that has done ``uv run playwright install chromium``. It proves the
``EXTRACT_JS`` extraction matches what ``build_observation`` expects.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from jobhuntz_agent.browser.observer import observe_page

sync_playwright = pytest.importorskip("playwright.sync_api").sync_playwright

FIXTURES = Path(__file__).parent / "fixtures"


def _file_url(name: str) -> str:
    return (FIXTURES / name).resolve().as_uri()


@pytest.fixture(scope="module")
def browser():
    try:
        pw = sync_playwright().start()
        br = pw.chromium.launch(headless=True)
    except Exception as exc:  # no browser binary installed
        pytest.skip(f"Chromium not available for Playwright: {exc}")
        return
    yield br
    br.close()
    pw.stop()


@pytest.fixture()
def page(browser):
    ctx = browser.new_context()
    pg = ctx.new_page()
    yield pg
    ctx.close()


def _goto(page, name: str):
    page.goto(_file_url(name), wait_until="domcontentloaded")
    return observe_page(page)


def test_greenhouse_form_fields(page):
    obs = _goto(page, "greenhouse_form.html")
    labels = [el.label for el in obs.elements]
    for expected in [
        "First name",
        "Email address",
        "Resume/CV",
        "Where are you based?",
        "How did you hear about us?",
        "Submit application",
    ]:
        assert any(expected in lab for lab in labels), f"missing {expected!r} in {labels}"

    # The hidden input must not appear.
    assert not any(el.name == "job_application[utm]" for el in obs.elements)

    # Required flags.
    first = next(el for el in obs.elements if "First name" in el.label)
    phone = next(el for el in obs.elements if el.label == "Phone")
    assert first.required is True
    assert phone.required is False

    # The select's options.
    location = next(el for el in obs.elements if "Where are you based" in el.label)
    assert location.role == "combobox"
    assert [o.value for o in location.options] == ["", "london", "manchester", "remote_uk"]

    # The radio group collapsed into one element with three options.
    group = next(el for el in obs.elements if el.role == "radiogroup")
    assert [o.value for o in group.options] == ["linkedin", "referral", "other"]

    # No wall on a plain form.
    assert obs.has_wall is False


def test_stable_indices_and_selectors_on_rerun(page):
    page.goto(_file_url("greenhouse_form.html"), wait_until="domcontentloaded")
    first = observe_page(page)
    second = observe_page(page)
    assert [e.index for e in first.elements] == [e.index for e in second.elements]
    assert [e.selector for e in first.elements] == [e.selector for e in second.elements]
    assert all(e.selector for e in first.elements)
    # The id-bearing fields use an id selector.
    assert next(e for e in first.elements if "First name" in e.label).selector == "#first_name"


def test_greenhouse_embed_reaches_into_the_iframe(page):
    obs = _goto(page, "greenhouse_embed.html")
    # The host page's own search field.
    assert any(el.label == "Search the site" for el in obs.elements)
    # Fields from inside the embedded Greenhouse form.
    assert any("Resume/CV" in el.label for el in obs.elements)
    assert any(el.role == "radiogroup" for el in obs.elements)
    # The embedded fields carry a non-empty frame_path.
    embedded = [el for el in obs.elements if "Resume/CV" in el.label]
    assert embedded and all(el.frame_path for el in embedded)


def test_lever_form_fields(page):
    obs = _goto(page, "lever_form.html")
    labels = [el.label for el in obs.elements]
    assert any("Full name" in lab for lab in labels)
    assert any("Email" in lab for lab in labels)
    years = next(el for el in obs.elements if "Years of experience" in el.label)
    assert [o.value for o in years.options] == ["", "0-2", "3-5", "6+"]


def test_login_wall_is_flagged(page):
    obs = _goto(page, "login_wall.html")
    assert obs.login_wall is True
    assert obs.has_wall is True


def test_recaptcha_is_flagged(page):
    obs = _goto(page, "recaptcha.html")
    assert obs.captcha is True
    assert obs.has_wall is True
