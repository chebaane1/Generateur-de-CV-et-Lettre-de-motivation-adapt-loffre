"""Plain-text helpers: LaTeX escaping and tolerant readers for the AI's JSON."""
import re
from typing import Any, List

_UNESCAPE = [
    (r"\textbackslash{}", "\\"), (r"\textasciitilde{}", "~"), (r"\textasciicircum{}", "^"),
    (r"\&", "&"), (r"\%", "%"), (r"\$", "$"), (r"\#", "#"), (r"\_", "_"), (r"\{", "{"), (r"\}", "}"),
]
_TEX_MAP = {
    "\\": r"\textbackslash{}", "%": r"\%", "&": r"\&", "_": r"\_", "#": r"\#",
    "$": r"\$", "{": r"\{", "}": r"\}", "~": r"\textasciitilde{}", "^": r"\textasciicircum{}",
}
_TEX_RE = re.compile(r"[\\%&_#${}~^]")


def raw(text: Any) -> str:
    """Undo any LaTeX escaping already present in the input, so we never double-escape."""
    if text is None:
        return ""
    text = str(text)
    for esc, ch in _UNESCAPE:
        text = text.replace(esc, ch)
    return text.strip()


def tex(text: Any) -> str:
    """Escape plain text for LaTeX exactly once (safe for raw or pre-escaped input)."""
    return _TEX_RE.sub(lambda m: _TEX_MAP[m.group()], raw(text))


def tex_url(url: str) -> str:
    url = re.sub(r"[\s\\{}]", "", raw(url))
    return url.replace("%", r"\%").replace("#", r"\#")


def clean_keys(obj: Any) -> Any:
    """Normalise keys like 'PROFILE\\_SUMMARY' back to 'PROFILE_SUMMARY'."""
    if isinstance(obj, dict):
        return {raw(k): clean_keys(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [clean_keys(v) for v in obj]
    return obj


def first(d: dict, *keys, default=""):
    for k in keys:
        v = d.get(k)
        if v not in (None, "", [], {}):
            return v
    return default


def as_list(v: Any) -> List[str]:
    if v is None:
        return []
    if isinstance(v, str):
        return [v] if v.strip() else []
    if isinstance(v, list):
        out = []
        for x in v:
            if isinstance(x, dict):
                x = first(x, "name", "title", "label", "value")
            if x and str(x).strip():
                out.append(str(x))
        return out
    return [str(v)]


def is_english(text: str) -> bool:
    t = " " + raw(text).lower() + " "
    fr = len(re.findall(r"[éèêàùçôî]", t)) + sum(t.count(w) for w in [" le ", " la ", " les ", " des ", " et ", " du "])
    en = sum(t.count(w) for w in [" the ", " and ", " of ", " with ", " for ", " in "])
    return en > fr
