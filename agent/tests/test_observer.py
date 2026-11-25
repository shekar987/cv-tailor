"""The observer's pure assembly logic (no browser).

These drive ``build_observation`` with raw element payloads shaped exactly like
``EXTRACT_JS`` returns, so they cover labelling, required flags, select/radio
options, stable selectors and indices, and wall detection — all runnable with
no Playwright. ``test_observer_browser.py`` runs the real extraction against the
HTML fixtures (skipped where Playwright is not installed).
"""

from __future__ import annotations

from jobhuntz_agent.browser.observer import (
    build_observation,
    element_label,
    element_selector,
    infer_role,
)


def raw_el(**kw):
    base = {
        "tag": "input",
        "type": "text",
        "id": "",
        "name": "",
        "data_attr": "",
        "data_qa": "",
        "aria_label": "",
        "aria_labelledby": "",
        "label_for": "",
        "wrapping_label": "",
        "group_label": "",
        "placeholder": "",
        "nearby_text": "",
        "text": "",
        "required": False,
        "value": "",
        "visible": True,
        "xpath": "/html/body/input[1]",
        "href": "",
        "checked": False,
        "multiple": False,
        "options": [],
        "frame_path": "",
    }
    base.update(kw)
    return base


# A payload mirroring greenhouse_form.html — the same fields, in document order.
def greenhouse_raw():
    elements = [
        raw_el(id="first_name", name="job_application[first_name]", label_for="First name *", required=True),
        raw_el(id="last_name", name="job_application[last_name]", label_for="Last name *", required=True),
        raw_el(id="email", type="email", name="job_application[email]", label_for="Email address *", required=True),
        raw_el(id="phone", type="tel", name="job_application[phone]", label_for="Phone"),
        raw_el(type="url", name="job_application[linkedin]", data_attr="data-qa", data_qa="linkedin-url", wrapping_label="LinkedIn profile"),
        raw_el(name="job_application[website]", aria_label="Personal website", placeholder="https://…"),
        raw_el(name="job_application[referral]", placeholder="Who referred you?"),
        raw_el(id="resume", type="file", name="job_application[resume]", label_for="Resume/CV *", required=True),
        raw_el(
            tag="select", type=None, id="location", name="job_application[location]",
            label_for="Where are you based? *", required=True,
            options=[
                {"value": "", "label": "Select…", "selected": True},
                {"value": "london", "label": "London, UK", "selected": False},
                {"value": "manchester", "label": "Manchester, UK", "selected": False},
                {"value": "remote_uk", "label": "Remote (UK)", "selected": False},
            ],
        ),
        raw_el(type="checkbox", name="job_application[newsletter]", value="yes", wrapping_label="Keep me posted about future roles"),
        raw_el(type="radio", name="job_application[source]", value="linkedin", group_label="How did you hear about us? *", required=True, wrapping_label="LinkedIn"),
        raw_el(type="radio", name="job_application[source]", value="referral", group_label="How did you hear about us? *", wrapping_label="A friend"),
        raw_el(type="radio", name="job_application[source]", value="other", group_label="How did you hear about us? *", wrapping_label="Other"),
        raw_el(tag="button", type="submit", id="submit_app", text="Submit application"),
    ]
    return {
        "url": "https://boards.greenhouse.io/acme/jobs/123",
        "title": "Apply: Software Engineer — Acme Robotics",
        "elements": elements,
        "headings": ["Apply for Software Engineer", "How did you hear about us? *"],
        "password_fields": 0,
        "iframes": [],
        "scripts": [],
        "captcha": False,
    }


def test_finds_every_labelled_field():
    obs = build_observation(greenhouse_raw())
    labels = [el.label for el in obs.elements]
    assert labels == [
        "First name *",
        "Last name *",
        "Email address *",
        "Phone",
        "LinkedIn profile",
        "Personal website",
        "Who referred you?",
        "Resume/CV *",
        "Where are you based? *",
        "Keep me posted about future roles",
        "How did you hear about us? *",  # the radio group, collapsed
        "Submit application",
    ]


def test_required_flags_are_correct():
    obs = build_observation(greenhouse_raw())
    required = {el.label: el.required for el in obs.elements}
    assert required["First name *"] is True
    assert required["Email address *"] is True
    assert required["Resume/CV *"] is True
    assert required["Where are you based? *"] is True
    assert required["How did you hear about us? *"] is True  # first radio was required
    assert required["Phone"] is False
    assert required["Personal website"] is False


def test_select_options_are_captured():
    obs = build_observation(greenhouse_raw())
    location = next(el for el in obs.elements if el.label == "Where are you based? *")
    assert location.role == "combobox"
    assert [o.value for o in location.options] == ["", "london", "manchester", "remote_uk"]
    assert [o.label for o in location.options] == ["Select…", "London, UK", "Manchester, UK", "Remote (UK)"]


def test_radio_group_collapses_to_one_element_with_options():
    obs = build_observation(greenhouse_raw())
    groups = [el for el in obs.elements if el.role == "radiogroup"]
    assert len(groups) == 1
    group = groups[0]
    assert group.name == "job_application[source]"
    assert [o.value for o in group.options] == ["linkedin", "referral", "other"]
    assert [o.label for o in group.options] == ["LinkedIn", "A friend", "Other"]


def test_roles_are_inferred():
    obs = build_observation(greenhouse_raw())
    by_label = {el.label: el.role for el in obs.elements}
    assert by_label["Resume/CV *"] == "file"
    assert by_label["Where are you based? *"] == "combobox"
    assert by_label["Keep me posted about future roles"] == "checkbox"
    assert by_label["How did you hear about us? *"] == "radiogroup"
    assert by_label["Submit application"] == "button"
    assert by_label["Email address *"] == "textbox"


def test_indices_are_sequential_and_stable_on_rerun():
    first = build_observation(greenhouse_raw())
    second = build_observation(greenhouse_raw())
    assert [el.index for el in first.elements] == list(range(len(first.elements)))
    assert first.model_dump() == second.model_dump()  # identical input → identical output


def test_every_element_has_a_selector():
    obs = build_observation(greenhouse_raw())
    assert all(el.selector for el in obs.elements)


def test_selector_prefers_id_then_name_then_data_then_xpath():
    # id wins
    assert element_selector(raw_el(id="first_name", name="x")) == "#first_name"
    # an id with awkward characters falls back to an attribute selector
    assert element_selector(raw_el(id="job[app].1")) == '[id="job[app].1"]'
    # name when there is no id
    assert element_selector(raw_el(tag="select", name="job_application[location]")) == 'select[name="job_application[location]"]'
    # data-* when there is neither id nor name
    assert element_selector(raw_el(data_attr="data-qa", data_qa="resume-upload")) == '[data-qa="resume-upload"]'
    # xpath when nothing else identifies it
    assert element_selector(raw_el(xpath="/html/body/form/input[3]")) == "xpath=/html/body/form/input[3]"


def test_label_resolution_order():
    assert element_label(raw_el(aria_label="A", label_for="B", placeholder="C")) == "A"
    assert element_label(raw_el(label_for="B", wrapping_label="W", placeholder="C")) == "B"
    assert element_label(raw_el(wrapping_label="W", placeholder="C")) == "W"
    assert element_label(raw_el(placeholder="C", nearby_text="N")) == "C"
    assert element_label(raw_el(nearby_text="N")) == "N"
    assert element_label(raw_el(text="Submit")) == "Submit"
    assert element_label(raw_el(name="only_name")) == "only_name"


def test_infer_role_covers_the_control_types():
    assert infer_role(raw_el(tag="textarea", type=None)) == "textbox"
    assert infer_role(raw_el(tag="select", multiple=True)) == "listbox"
    assert infer_role(raw_el(tag="a", type=None, href="/x")) == "link"
    assert infer_role(raw_el(tag="input", type="submit")) == "button"
    assert infer_role(raw_el(tag="input", type="file")) == "file"
    assert infer_role(raw_el(tag="input", type="checkbox")) == "checkbox"


# ── walls ─────────────────────────────────────────────────────────────────────
def test_login_wall_from_a_password_field():
    raw = {
        "url": "https://acme.example/login",
        "title": "Sign in",
        "elements": [
            raw_el(id="login_email", type="email", label_for="Email"),
            raw_el(id="login_password", type="password", label_for="Password"),
        ],
        "headings": ["Sign in to continue your application"],
        "password_fields": 1,
        "iframes": [],
        "scripts": [],
        "captcha": False,
    }
    obs = build_observation(raw)
    assert obs.login_wall is True
    assert obs.captcha is False
    assert obs.has_wall is True
    assert "sign-in" in (obs.wall_reason or "")


def test_login_wall_from_a_heading_without_a_password_field():
    raw = {
        "url": "https://acme.example/account",
        "title": "",
        "elements": [],
        "headings": ["Create an account to apply"],
        "password_fields": 0,
        "iframes": [],
        "scripts": [],
        "captcha": False,
    }
    assert build_observation(raw).login_wall is True


def test_captcha_from_a_dom_signal():
    raw = {
        "url": "https://acme.example/apply",
        "title": "Verify you are human",
        "elements": [raw_el(id="full_name", label_for="Full name")],
        "headings": ["Almost there"],
        "password_fields": 0,
        "iframes": ["https://www.google.com/recaptcha/api2/anchor?k=abc"],
        "scripts": [],
        "captcha": True,
    }
    obs = build_observation(raw)
    assert obs.captcha is True
    assert obs.login_wall is False
    assert "captcha" in (obs.wall_reason or "")


def test_captcha_from_an_iframe_host_only():
    raw = {
        "url": "https://acme.example/apply",
        "title": "Apply",
        "elements": [],
        "headings": [],
        "password_fields": 0,
        "iframes": ["https://hcaptcha.com/1/challenge"],
        "scripts": [],
        "captcha": False,  # DOM signal missed it; the host still gives it away
    }
    assert build_observation(raw).captcha is True


def test_no_wall_on_a_clean_form():
    obs = build_observation(greenhouse_raw())
    assert obs.login_wall is False
    assert obs.captcha is False
    assert obs.has_wall is False
    assert obs.wall_reason is None


def test_event_payload_is_bounded():
    obs = build_observation(greenhouse_raw())
    payload = obs.to_event_payload(max_elements=3)
    assert payload["field_count"] == len(obs.elements)
    assert len(payload["elements"]) == 3
    assert payload["truncated"] is True
    assert payload["counts"]["textbox"] >= 1
