"""The page observer — the worker's eyes (Chunk 35).

It is **read-only**: it never types, clicks a field, or submits anything. Given
a loaded page it produces a numbered list of the form's controls (inputs,
selects, textareas, file inputs, buttons and links inside forms), reaching into
child frames such as a Greenhouse embed, and it flags two walls it must not try
to pass — a sign-in screen (``login_wall``) and a reCAPTCHA / hCaptcha
(``captcha``).

The design has two halves so the logic is testable without a browser:

- ``EXTRACT_JS`` runs in each frame and returns raw element dicts.
- ``build_observation`` (pure) turns the merged raw payload into the numbered,
  labelled, de-duplicated :class:`PageObservation`. It assigns stable indices in
  document order and a stable ``selector`` per element (id → name → data-* →
  XPath), so re-running on the same page gives the same list.

``observe_page`` is the thin browser wrapper that runs the JS in every frame and
calls ``build_observation``.
"""

from __future__ import annotations

import re
from typing import Any, Iterable, Optional

from pydantic import BaseModel, ConfigDict, Field

# ── wall patterns ────────────────────────────────────────────────────────────
# A heading that means "sign in before you can apply".
LOGIN_HEADING_RE = re.compile(
    r"\b(sign in|signin|log ?in|sign up|create (?:an )?account|create your account)\b",
    re.IGNORECASE,
)
# A captcha, detected by the host its iframe/script loads from.
CAPTCHA_HOST_RE = re.compile(
    r"(recaptcha|hcaptcha|/captcha|turnstile|arkoselabs|funcaptcha|geetest)",
    re.IGNORECASE,
)

# input types that are a single-line text box for our purposes.
_TEXT_INPUT_TYPES = {
    "text", "email", "tel", "url", "search", "number", "password",
    "date", "month", "week", "time", "datetime-local", "",
}


# ── models ───────────────────────────────────────────────────────────────────
class ElementOption(BaseModel):
    model_config = ConfigDict(extra="ignore")
    value: str = ""
    label: str = ""
    selected: bool = False


class ObservedElement(BaseModel):
    """One control the worker can see, numbered for the Fields drawer."""

    model_config = ConfigDict(extra="ignore")

    index: int
    role: str
    tag: str
    type: Optional[str] = None
    label: str = ""
    name: Optional[str] = None
    required: bool = False
    options: list[ElementOption] = Field(default_factory=list)
    value: Optional[str] = None
    placeholder: Optional[str] = None
    visible: bool = True
    frame_path: str = ""
    selector: str = ""
    autocomplete: Optional[str] = None


class PageObservation(BaseModel):
    """Everything the worker saw on one page, ready to upload / render."""

    model_config = ConfigDict(extra="ignore")

    url: str = ""
    title: str = ""
    elements: list[ObservedElement] = Field(default_factory=list)
    login_wall: bool = False
    captcha: bool = False
    wall_reason: Optional[str] = None

    @property
    def has_wall(self) -> bool:
        return self.login_wall or self.captcha

    def counts(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for el in self.elements:
            out[el.role] = out.get(el.role, 0) + 1
        return out

    def to_event_payload(self, *, max_elements: int = 200, max_options: int = 60) -> dict[str, Any]:
        """A bounded dict for the ``observed`` timeline event (jsonb). Caps the
        element and option counts so a huge page can never bloat the row, and
        says when it truncated."""
        kept = self.elements[:max_elements]
        elements = []
        for el in kept:
            elements.append(
                {
                    "index": el.index,
                    "role": el.role,
                    "type": el.type,
                    "label": el.label[:200],
                    "name": el.name,
                    "required": el.required,
                    "visible": el.visible,
                    "frame_path": el.frame_path,
                    "selector": el.selector[:400],
                    "options": [
                        {"value": o.value[:120], "label": o.label[:120]}
                        for o in el.options[:max_options]
                    ],
                }
            )
        return {
            "url": self.url,
            "title": self.title,
            "login_wall": self.login_wall,
            "captcha": self.captcha,
            "wall_reason": self.wall_reason,
            "counts": self.counts(),
            "field_count": len(self.elements),
            "truncated": len(self.elements) > len(kept),
            "elements": elements,
        }


# ── pure helpers ───────────────────────────────────────────────────────────--
def _clean(text: Any) -> str:
    if not isinstance(text, str):
        return ""
    return re.sub(r"\s+", " ", text).strip()


def element_label(raw: dict[str, Any]) -> str:
    """The best human label for a control, in the order the brief sets:
    aria-label, aria-labelledby, ``<label for>``, the wrapping label,
    placeholder, nearby text, then the group's legend, then the name."""
    for key in (
        "aria_label",
        "aria_labelledby",
        "label_for",
        "wrapping_label",
        "placeholder",
        "nearby_text",
        "text",  # a button's / link's / submit's own text
        "group_label",
    ):
        val = _clean(raw.get(key))
        if val:
            return val
    name = _clean(raw.get("name"))
    return name


_SAFE_ID_RE = re.compile(r"^[A-Za-z_][\w-]*$")


def _css_escape_attr(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def element_selector(raw: dict[str, Any]) -> str:
    """A stable selector: id → name → data-* → XPath. Frame-relative — the frame
    is carried separately in ``frame_path``."""
    el_id = _clean(raw.get("id"))
    if el_id:
        return f"#{el_id}" if _SAFE_ID_RE.match(el_id) else f'[id="{_css_escape_attr(el_id)}"]'
    tag = _clean(raw.get("tag")) or "*"
    name = _clean(raw.get("name"))
    if name:
        return f'{tag}[name="{_css_escape_attr(name)}"]'
    data_attr = _clean(raw.get("data_attr"))
    data_val = _clean(raw.get("data_qa"))
    if data_attr and data_val:
        return f'[{data_attr}="{_css_escape_attr(data_val)}"]'
    xpath = raw.get("xpath")
    if isinstance(xpath, str) and xpath.strip():
        return f"xpath={xpath.strip()}"
    return tag


def infer_role(raw: dict[str, Any]) -> str:
    """Map a tag/type to a coarse role the drawer and the (future) filler use."""
    tag = (_clean(raw.get("tag")) or "").lower()
    typ = (_clean(raw.get("type")) or "").lower()
    if tag == "select":
        return "listbox" if raw.get("multiple") else "combobox"
    if tag == "textarea":
        return "textbox"
    if tag == "a":
        return "link"
    if tag == "button":
        return "button"
    if tag == "input":
        if typ in {"submit", "button", "reset", "image"}:
            return "button"
        if typ == "checkbox":
            return "checkbox"
        if typ == "radio":
            return "radio"
        if typ == "file":
            return "file"
        if typ in _TEXT_INPUT_TYPES:
            return "textbox"
        return "textbox"
    return tag or "unknown"


def _radio_group_key(raw: dict[str, Any]) -> tuple[str, str]:
    return (_clean(raw.get("frame_path")), _clean(raw.get("name")))


def build_observation(raw: dict[str, Any]) -> PageObservation:
    """Turn the merged raw extraction into the numbered observation. Pure — the
    same input always yields the same output (same indices, same selectors)."""
    url = _clean(raw.get("url"))
    title = _clean(raw.get("title"))
    raw_elements: list[dict[str, Any]] = [e for e in (raw.get("elements") or []) if isinstance(e, dict)]

    elements: list[ObservedElement] = []
    # Radios with a shared (frame, name) collapse into one radiogroup, placed at
    # the first radio's position; its options are each radio's value/label.
    radio_index: dict[tuple[str, str], int] = {}
    next_index = 0

    for raw_el in raw_elements:
        role = infer_role(raw_el)
        frame_path = _clean(raw_el.get("frame_path"))

        if role == "radio":
            key = _radio_group_key(raw_el)
            option = ElementOption(
                value=_clean(raw_el.get("value")),
                label=element_label(raw_el) or _clean(raw_el.get("value")),
                selected=bool(raw_el.get("checked")),
            )
            if key in radio_index:
                elements[radio_index[key]].options.append(option)
                if option.selected:
                    elements[radio_index[key]].value = option.value
                continue
            # First radio of the group: it becomes the radiogroup element.
            group_label = _clean(raw_el.get("group_label")) or _clean(raw_el.get("name"))
            el = ObservedElement(
                index=next_index,
                role="radiogroup",
                tag="input",
                type="radio",
                label=group_label,
                name=_clean(raw_el.get("name")) or None,
                required=bool(raw_el.get("required")),
                options=[option],
                value=option.value if option.selected else None,
                visible=bool(raw_el.get("visible", True)),
                frame_path=frame_path,
                selector=f'input[name="{_css_escape_attr(_clean(raw_el.get("name")))}"]'
                if _clean(raw_el.get("name"))
                else element_selector(raw_el),
                autocomplete=_clean(raw_el.get("autocomplete")) or None,
            )
            radio_index[key] = len(elements)
            elements.append(el)
            next_index += 1
            continue

        options = [
            ElementOption(
                value=_clean(o.get("value")),
                label=_clean(o.get("label")) or _clean(o.get("value")),
                selected=bool(o.get("selected")),
            )
            for o in (raw_el.get("options") or [])
            if isinstance(o, dict)
        ]
        el = ObservedElement(
            index=next_index,
            role=role,
            tag=(_clean(raw_el.get("tag")) or "").lower(),
            type=_clean(raw_el.get("type")) or None,
            label=element_label(raw_el),
            name=_clean(raw_el.get("name")) or None,
            required=bool(raw_el.get("required")),
            options=options,
            value=_clean(raw_el.get("value")) or None,
            placeholder=_clean(raw_el.get("placeholder")) or None,
            visible=bool(raw_el.get("visible", True)),
            frame_path=frame_path,
            selector=element_selector(raw_el),
            autocomplete=_clean(raw_el.get("autocomplete")) or None,
        )
        elements.append(el)
        next_index += 1

    login_wall, captcha, wall_reason = detect_walls(raw, elements)
    return PageObservation(
        url=url,
        title=title,
        elements=elements,
        login_wall=login_wall,
        captcha=captcha,
        wall_reason=wall_reason,
    )


def detect_walls(
    raw: dict[str, Any], elements: Iterable[ObservedElement]
) -> tuple[bool, bool, Optional[str]]:
    """Login-wall and captcha detection (guardrails 1 and 2). Conservative — a
    wall only ever *pauses* the job; it never bypasses anything."""
    reasons: list[str] = []

    password_fields = int(raw.get("password_fields") or 0)
    headings: list[str] = [_clean(h) for h in (raw.get("headings") or []) if isinstance(h, str)]
    login_wall = password_fields > 0 or any(LOGIN_HEADING_RE.search(h) for h in headings)
    if login_wall:
        if password_fields > 0:
            reasons.append("a password field (sign-in)")
        else:
            reasons.append("a sign-in heading")

    iframes: list[str] = [_clean(s) for s in (raw.get("iframes") or []) if isinstance(s, str)]
    scripts: list[str] = [_clean(s) for s in (raw.get("scripts") or []) if isinstance(s, str)]
    captcha = bool(raw.get("captcha")) or any(
        CAPTCHA_HOST_RE.search(s) for s in (*iframes, *scripts)
    )
    if captcha:
        reasons.append("a captcha")

    reason = None
    if reasons:
        reason = "Paused — this page has " + " and ".join(reasons) + ". A human needs to take over."
    return login_wall, captcha, reason


# ── the JavaScript that runs in each frame ─────────────────────────────────────
# Returns a per-frame payload. Pure DOM read — it never changes the page.
EXTRACT_JS = r"""
() => {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

  const isVisible = (el) => {
    try {
      if (el.getClientRects().length === 0) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
    } catch (e) {
      return true;
    }
  };

  const xpathOf = (el) => {
    if (el.id) return `//*[@id=${JSON.stringify(el.id)}]`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement.parentNode) {
      let ix = 1;
      let sib = node.previousElementSibling;
      while (sib) { if (sib.nodeName === node.nodeName) ix++; sib = sib.previousElementSibling; }
      parts.unshift(`${node.nodeName.toLowerCase()}[${ix}]`);
      node = node.parentElement;
    }
    return "/" + parts.join("/");
  };

  const dataAttr = (el) => {
    for (const a of ["data-qa", "data-test", "data-testid", "data-automation-id"]) {
      if (el.hasAttribute(a)) return { attr: a, value: el.getAttribute(a) || "" };
    }
    return { attr: "", value: "" };
  };

  const labelFor = (el) => {
    if (!el.id) return "";
    try {
      const l = document.querySelector(`label[for=${JSON.stringify(el.id)}]`);
      return l ? clean(l.textContent) : "";
    } catch (e) { return ""; }
  };

  const wrappingLabel = (el) => {
    const l = el.closest("label");
    return l ? clean(l.textContent) : "";
  };

  const ariaLabelledby = (el) => {
    const ids = (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
    const txt = ids.map((id) => { const n = document.getElementById(id); return n ? n.textContent : ""; }).join(" ");
    return clean(txt);
  };

  const groupLabel = (el) => {
    const fs = el.closest("fieldset");
    if (fs) { const lg = fs.querySelector("legend"); if (lg) return clean(lg.textContent); }
    return "";
  };

  const nearbyText = (el) => {
    const prev = el.previousElementSibling;
    if (prev && !/^(input|select|textarea|button)$/i.test(prev.nodeName)) {
      const t = clean(prev.textContent);
      if (t) return t.slice(0, 160);
    }
    return "";
  };

  const isRequired = (el) =>
    el.required === true ||
    el.getAttribute("aria-required") === "true" ||
    el.hasAttribute("required");

  const controlText = (el, tag, type) => {
    if (tag === "a" || tag === "button") return clean(el.textContent).slice(0, 160);
    if (tag === "input" && /^(submit|button|reset)$/.test(type)) return clean(el.value || "");
    return "";
  };

  const out = [];
  const controls = document.querySelectorAll(
    "input, select, textarea, button, form a[href]"
  );
  controls.forEach((el) => {
    const tag = el.nodeName.toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (tag === "input" && type === "hidden") return;
    const da = dataAttr(el);
    const base = {
      tag,
      text: controlText(el, tag, type),
      type: type || null,
      id: el.id || "",
      name: el.getAttribute("name") || "",
      data_attr: da.attr,
      data_qa: da.value,
      aria_label: clean(el.getAttribute("aria-label") || ""),
      aria_labelledby: ariaLabelledby(el),
      label_for: labelFor(el),
      wrapping_label: wrappingLabel(el),
      group_label: groupLabel(el),
      placeholder: clean(el.getAttribute("placeholder") || ""),
      nearby_text: nearbyText(el),
      autocomplete: el.getAttribute("autocomplete") || "",
      required: isRequired(el),
      value: tag === "select" ? "" : clean(el.value || ""),
      visible: isVisible(el),
      xpath: xpathOf(el),
      href: tag === "a" ? (el.getAttribute("href") || "") : "",
      checked: (type === "checkbox" || type === "radio") ? !!el.checked : false,
      multiple: tag === "select" ? !!el.multiple : false,
      options: [],
    };
    if (tag === "select") {
      base.options = Array.from(el.options || []).map((o) => ({
        value: o.value, label: clean(o.textContent), selected: !!o.selected,
      }));
    }
    out.push(base);
  });

  const headings = Array.from(document.querySelectorAll("h1, h2, h3, legend"))
    .map((h) => clean(h.textContent)).filter(Boolean).slice(0, 40);
  const passwordFields = document.querySelectorAll('input[type="password"]').length;
  const iframes = Array.from(document.querySelectorAll("iframe")).map((f) => f.src || "").filter(Boolean);
  const scripts = Array.from(document.querySelectorAll("script[src]")).map((s) => s.src || "").filter(Boolean);
  const captcha = !!(
    document.querySelector(".g-recaptcha, [data-sitekey], iframe[src*='recaptcha'], iframe[src*='hcaptcha'], iframe[title*='captcha' i]")
  );

  return {
    title: clean(document.title || ""),
    elements: out,
    headings,
    password_fields: passwordFields,
    iframes,
    scripts,
    captcha,
  };
}
"""


def merge_frame_payloads(url: str, frames: list[dict[str, Any]]) -> dict[str, Any]:
    """Concatenate the per-frame extraction payloads into one raw dict, tagging
    every element with its ``frame_path`` and summing the page-level signals.
    Frame order is the order given (main frame first), so indices are stable."""
    elements: list[dict[str, Any]] = []
    headings: list[str] = []
    iframes: list[str] = []
    scripts: list[str] = []
    password_fields = 0
    captcha = False
    title = ""
    for i, payload in enumerate(frames):
        if not isinstance(payload, dict):
            continue
        frame_path = str(payload.get("frame_path") or "")
        if i == 0 and not title:
            title = str(payload.get("title") or "")
        for el in payload.get("elements") or []:
            if isinstance(el, dict):
                el = {**el, "frame_path": frame_path}
                elements.append(el)
        headings.extend([h for h in (payload.get("headings") or []) if isinstance(h, str)])
        iframes.extend([s for s in (payload.get("iframes") or []) if isinstance(s, str)])
        scripts.extend([s for s in (payload.get("scripts") or []) if isinstance(s, str)])
        password_fields += int(payload.get("password_fields") or 0)
        captcha = captcha or bool(payload.get("captcha"))
    return {
        "url": url,
        "title": title,
        "elements": elements,
        "headings": headings,
        "iframes": iframes,
        "scripts": scripts,
        "password_fields": password_fields,
        "captcha": captcha,
    }


def _frame_path(frame: Any, main: Any) -> str:
    """A short, stable label for a frame: "" for the main frame, else its URL."""
    if frame is main:
        return ""
    try:
        return str(frame.url or f"frame:{frame.name}")
    except Exception:  # pragma: no cover - defensive
        return "frame"


def observe_page(page: Any) -> PageObservation:
    """Run the extraction in the main frame and every child frame, then build the
    observation. The browser wrapper — kept thin so the logic above stays pure."""
    main = page.main_frame
    ordered = [main] + [f for f in page.frames if f is not main]
    payloads: list[dict[str, Any]] = []
    for frame in ordered:
        try:
            data = frame.evaluate(EXTRACT_JS)
        except Exception:
            # A frame we cannot read (navigating, detached, blocked) is skipped —
            # we still report everything we could see.
            continue
        if isinstance(data, dict):
            data["frame_path"] = _frame_path(frame, main)
            payloads.append(data)
    raw = merge_frame_payloads(_safe_url(page), payloads)
    return build_observation(raw)


def _safe_url(page: Any) -> str:
    try:
        return str(page.url or "")
    except Exception:  # pragma: no cover - defensive
        return ""
