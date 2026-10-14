"""LaTeX building blocks shared by the CV and the cover letter, and the XeLaTeX compiler."""
import os
import re
import subprocess
import tempfile
from typing import Any, List

from fastapi import HTTPException

from .text import raw, tex, tex_url

def github_link(value: str) -> str:
    value = raw(value)
    if not value:
        return ""
    label = re.sub(r"^https?://", "", value)
    if "github.com" not in label:
        label = f"github.com/{label}"
    return rf"\href{{https://{tex_url(label)}}}{{{tex(label)}}}"


def linkedin_link(value: str) -> str:
    value = raw(value)
    if not value:
        return ""
    if "linkedin.com" in value:
        label = re.sub(r"^https?://", "", value)
        return rf"\href{{https://{tex_url(label)}}}{{{tex(label)}}}"
    return "LinkedIn : " + tex(value)


def contact_line(location="", email="", phone="", github="", linkedin="") -> str:
    parts = []
    if raw(location):
        parts.append(tex(location))
    if raw(email):
        parts.append(rf"\href{{mailto:{tex_url(email)}}}{{{tex(email)}}}")
    if raw(phone):
        parts.append(tex(phone))
    if raw(github):
        parts.append(github_link(github))
    if raw(linkedin):
        parts.append(linkedin_link(linkedin))
    return r" ~$\diamond$~ ".join(parts)


def bold_terms(text: Any, terms: List[str]) -> str:
    """Escape text for LaTeX and put the given technologies in bold (whole words, longest first)."""
    out = tex(text)
    terms = sorted({raw(t) for t in terms if len(raw(t)) >= 2}, key=len, reverse=True)
    if not terms:
        return out
    # short names (R, Go, C#…) must match the case exactly, longer ones ignore case
    alts = [re.escape(tex(t)) if len(t) <= 3 else f"(?i:{re.escape(tex(t))})" for t in terms]
    pattern = re.compile(r"(?<![A-Za-z0-9])(?:" + "|".join(alts) + r")(?![A-Za-z0-9])")
    return pattern.sub(lambda m: rf"\textbf{{{m.group(0)}}}", out)


def itemize(items: List[str], terms: List[str] = ()) -> str:
    items = [i for i in items if raw(i)]
    if not items:
        return ""
    return "\\begin{itemize}\n" + "\n".join(rf"  \item {bold_terms(i, terms)}" for i in items) + "\n\\end{itemize}"


def compile_tex_pages(tex_content: str, name: str, label: str) -> tuple:
    """Compile with XeLaTeX, return (pdf bytes, number of pages)."""
    with tempfile.TemporaryDirectory() as temp_dir:
        tex_file = os.path.join(temp_dir, f"{name}.tex")
        pdf_file = os.path.join(temp_dir, f"{name}.pdf")
        log_file = os.path.join(temp_dir, f"{name}.log")
        with open(tex_file, "w", encoding="utf-8") as f:
            f.write(tex_content)

        cmd = ["xelatex", "-interaction=nonstopmode", "-halt-on-error",
               f"-output-directory={temp_dir}", tex_file]
        for _ in range(2):
            subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)

        if not os.path.exists(pdf_file):
            detail = "Erreur de compilation inconnue."
            if os.path.exists(log_file):
                with open(log_file, "r", encoding="utf-8", errors="ignore") as f:
                    lines = f.readlines()
                for i, line in enumerate(lines):
                    if line.startswith("!"):
                        detail = "".join(lines[i:i + 6]).strip()   # error + "l.<n>" context
                        break
            raise HTTPException(status_code=422, detail=f"Échec XeLaTeX ({label}) :\n{detail}")

        pages = 1
        with open(log_file, "r", encoding="utf-8", errors="ignore") as f:
            m = re.search(r"Output written on .*?\((\d+) pages?", f.read(), re.S)
            if m:
                pages = int(m.group(1))
        with open(pdf_file, "rb") as f:
            return f.read(), pages


def compile_tex(tex_content: str, name: str, label: str) -> bytes:
    return compile_tex_pages(tex_content, name, label)[0]


PREAMBLE = r"""\usepackage{fontspec}
\usepackage{polyglossia}
\setdefaultlanguage{%s}
\usepackage{xcolor}
\usepackage[hidelinks]{hyperref}
\usepackage{enumitem}"""
