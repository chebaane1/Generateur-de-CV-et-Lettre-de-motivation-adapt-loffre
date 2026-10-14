import base64
import os
import re
import subprocess
import tempfile
from typing import Any, Dict, List
from urllib.parse import quote

from fastapi import Body, FastAPI, HTTPException, Response
from fastapi.responses import JSONResponse

app = FastAPI()

# Identity comes from .env (used as fallback for the resume, and for the cover letter)
ENV = {k: os.getenv(k, "") for k in
       ["CV_NAME", "CV_LOCATION", "CV_EMAIL", "CV_PHONE", "CV_GITHUB", "CV_LINKEDIN"]}


# ================================================================ escaping ===
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
    """Undo any LaTeX escaping already applied upstream (n8n), so we never double-escape."""
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


# ================================================================ helpers ===
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


def two_col(left: str, right: str) -> str:
    return rf"{left} \hfill {right}" if right else left


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


def pdf_response(pdf: bytes, filename: str, output: str = "pdf") -> Response:
    """The PDF file, or {"pdf": "<base64>"} with ?output=base64 (used by n8n to send it to the web page)."""
    if output == "base64":
        return JSONResponse({"pdf": base64.b64encode(pdf).decode()})
    return Response(content=pdf, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="{filename}"; filename*=UTF-8\'\'{quote(filename)}'})


PREAMBLE = r"""\usepackage{fontspec}
\usepackage{polyglossia}
\setdefaultlanguage{%s}
\usepackage{xcolor}
\usepackage[hidelinks]{hyperref}
\usepackage{enumitem}"""


# ================================================================== resume ===
def normalize_resume(body: dict) -> dict:
    """Accept every shape the LLM has produced so far."""
    b = clean_keys(body)
    pi = b.get("personal_information") or b.get("basics") or {}

    summary = first(b, "PROFILE_SUMMARY", "summary") or first(pi, "summary")
    if not raw(summary):
        raise HTTPException(status_code=422, detail="PROFILE_SUMMARY manquant.")

    # skills: {"Cat": [..]}  or  [{"category": "Cat", "skills": [..]}]  or  ["a", "b"]
    skills_in, skills = b.get("skills") or {}, {}
    if isinstance(skills_in, dict):
        skills = {k: as_list(v) for k, v in skills_in.items()}
    elif isinstance(skills_in, list):
        for s in skills_in:
            if isinstance(s, dict):
                skills[first(s, "category", "name", default="Compétences")] = as_list(first(s, "skills", "keywords", "items", default=[]))
            elif s:
                skills.setdefault("", []).append(str(s))

    experience = []
    for e in b.get("experience") or b.get("work") or []:
        if not isinstance(e, dict):
            continue
        dates = first(e, "dates")
        if not dates and (e.get("startDate") or e.get("endDate")):
            dates = f"{e.get('startDate', '')} – {e.get('endDate', '')}".strip(" –")
        experience.append({
            "title": first(e, "title", "position", "role"),
            "company": first(e, "company", "name", "organization"),
            "dates": dates,
            "bullets": as_list(first(e, "responsibilities", "highlights", "bullets", "description", default=[])),
        })

    education = []
    for ed in b.get("education") or []:
        if not isinstance(ed, dict):
            continue
        dates = first(ed, "dates")
        if not dates and (ed.get("startDate") or ed.get("endDate")):
            dates = f"{ed.get('startDate', '')} – {ed.get('endDate', '')}".strip(" –")
        education.append({
            "degree": first(ed, "degree", "area", "studyType"),
            "institution": first(ed, "institution", "school"),
            "dates": dates,
            "details": first(ed, "details", "description"),
        })

    # projects: [{"name": .., "description": ..}]  or  ["Name • description"]
    projects = []
    for pr in b.get("PROJECTS") or b.get("projects") or []:
        if isinstance(pr, dict):
            projects.append({"name": first(pr, "name", "title"), "description": first(pr, "description", "summary"),
                             "url": first(pr, "url", "link")})
        elif raw(pr):
            projects.append({"name": "", "description": str(pr), "url": ""})

    lang = first(b, "SECTION_LANG", "LANG")
    english = raw(lang).lower().startswith("en") if lang else is_english(summary)

    return {
        "name": first(pi, "full_name", "name") or ENV["CV_NAME"],
        "headline": first(b, "HEADLINE") or first(pi, "title", "label"),
        "email": first(pi, "email") or ENV["CV_EMAIL"],
        "phone": first(pi, "phone") or ENV["CV_PHONE"],
        "github": first(pi, "github") or ENV["CV_GITHUB"],
        "linkedin": first(pi, "linkedin") or ENV["CV_LINKEDIN"],
        "summary": summary,
        "skills": skills,
        "experience": experience,
        "education": education,
        "projects": projects,
        "certifications": as_list(b.get("certifications")),
        "languages": as_list(b.get("languages")),
        "tech": as_list(b.get("TECH_KEYWORDS")),   # printed in bold in summary, bullets and projects
        "english": english,
    }


def render_resume(d: dict, size: float = 11) -> str:
    """One-page, single-column, serif layout (the style of the CV that got interviews)."""
    h = ({"profile": "Profile", "skills": "Skills", "edu": "Education", "exp": "Experience",
          "projects": "Projects", "certs": "Certifications", "langs": "Languages"} if d["english"] else
         {"profile": "Profil", "skills": "Compétences", "edu": "Formation", "exp": "Expérience",
          "projects": "Projets", "certs": "Certifications", "langs": "Langues"})
    out = [
        r"\documentclass[a4paper]{article}",
        r"\usepackage[a4paper,left=1.4cm,right=1.4cm,top=1.1cm,bottom=1.1cm]{geometry}",
        PREAMBLE % ("english" if d["english"] else "french"),
        # Times-like font, as in the original CV (TeX Gyre Termes ships with texlive-fonts-recommended)
        r"\setmainfont{texgyretermes}[Extension=.otf,UprightFont=*-regular,BoldFont=*-bold,"
        r"ItalicFont=*-italic,BoldItalicFont=*-bolditalic]",
        rf"\fontsize{{{size}}}{{{size * 1.2:.1f}}}\selectfont",
        r"\pagestyle{empty}",
        r"\setlength{\parindent}{0pt}",
        r"\setlist[itemize]{label=\textbullet,leftmargin=0.9em,labelsep=0.35em,topsep=1pt,itemsep=0pt,parsep=0pt}",
        # sections share the space left at the bottom of the page, so the page looks full
        r"\newcommand{\cvsection}[1]{\par\vspace{5pt plus 1fill}{\large\bfseries\MakeUppercase{#1}}\par\vspace{2pt}}",
        rf"\hypersetup{{pdfauthor={{{tex(d['name'])}}},pdftitle={{CV - {tex(d['name'])}}}}}",
        r"\begin{document}",
        rf"\fontsize{{{size}}}{{{size * 1.2:.1f}}}\selectfont",
        r"\begin{center}",
        rf"{{\LARGE\bfseries {tex(d['name']).upper()}}}\\[3pt]",
    ]
    if raw(d["headline"]):
        out.append(rf"{tex(d['headline'])}\\[2pt]")
    contacts = [rf"\href{{mailto:{tex_url(d['email'])}}}{{{tex(d['email'])}}}" if raw(d["email"]) else "",
                tex(d["phone"]) if raw(d["phone"]) else "",
                linkedin_link(d["linkedin"]), github_link(d["github"])]
    out += [r" \textbullet{} ".join(c for c in contacts if c), r"\end{center}",
            rf"\cvsection{{{h['profile']}}}", bold_terms(d["summary"], d["tech"])]

    skills = {k: v for k, v in d["skills"].items() if v}
    if skills:
        out.append(rf"\cvsection{{{h['skills']}}}")
        out.append(" \\\\\n".join((rf"\textbf{{{tex(cat)}:}} " if raw(cat) else "") + ", ".join(tex(i) for i in items)
                                  for cat, items in skills.items()))

    if d["education"]:
        out.append(rf"\cvsection{{{h['edu']}}}")
        rows = []
        for ed in d["education"]:
            title = " \\textbullet{} ".join(tex(x) for x in (ed["degree"], ed["institution"]) if raw(x))
            sub = ", ".join(tex(x) for x in (ed["dates"], ed["details"]) if raw(x))
            rows.append(rf"\textbf{{{title}}}" + (rf" \\ {sub}" if sub else ""))
        out.append(" \\\\[2pt]\n".join(rows))

    if d["experience"]:
        out.append(rf"\cvsection{{{h['exp']}}}")
        for e in d["experience"]:
            title = " \\textbullet{} ".join(tex(x) for x in (e["title"], e["company"]) if raw(x))
            line = rf"\textbf{{{title}}}" + (rf" --- \textit{{{tex(e['dates'])}}}" if raw(e["dates"]) else "")
            out += [r"\par\vspace{2pt}" + line + r"\nopagebreak", itemize(e["bullets"], d["tech"])]

    if d["projects"]:
        out.append(rf"\cvsection{{{h['projects']}}}")
        def project_name(p):
            name = rf"\textbf{{{tex(p['name'])}}}"
            return rf"\href{{{tex_url(p['url'])}}}{{{name}}}" if raw(p["url"]).startswith("http") else name
        out.append(r"\begin{itemize}" + "\n".join(
            r"  \item " + (project_name(p) + " --- " if raw(p["name"]) else "") + bold_terms(p["description"], d["tech"])
            for p in d["projects"] if raw(p["description"]) or raw(p["name"])) + r"\end{itemize}")

    if d["certifications"]:
        out += [rf"\cvsection{{{h['certs']}}}", "; ".join(tex(c) for c in d["certifications"])]

    if d["languages"]:
        out += [rf"\cvsection{{{h['langs']}}}", " \\textbullet{} ".join(tex(l) for l in d["languages"])]

    out.append(r"\end{document}")
    return "\n".join(out)


@app.post("/compile-resume")
async def compile_resume(body: Dict[str, Any] = Body(...), output: str = "pdf"):
    d = normalize_resume(body)
    # Exactly one full page: the largest font size that still fits on one page
    sizes = [9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5]
    i = sizes.index(11)
    pdf, pages = compile_tex_pages(render_resume(d, sizes[i]), "resume", "CV")
    step = 1 if pages <= 1 else -1
    while 0 <= i + step < len(sizes):
        nxt_pdf, nxt_pages = compile_tex_pages(render_resume(d, sizes[i + step]), "resume", "CV")
        if step > 0 and nxt_pages > 1:
            break                      # one size too big: keep the last one that fit
        i, pdf, pages = i + step, nxt_pdf, nxt_pages
        if step < 0 and pages <= 1:
            break                      # first size small enough
    return pdf_response(pdf, "CV_generated.pdf", output)


# ============================================================ cover letter ===
def render_letter(b: dict) -> str:
    b = clean_keys(b)
    paras = [first(b, k) for k in ["PARAGRAPH_HOOK", "PARAGRAPH_VALUE", "PARAGRAPH_ALIGNMENT", "PARAGRAPH_CTA"]]
    if not any(raw(p) for p in paras):
        raise HTTPException(status_code=422, detail="Paragraphes de la lettre manquants.")

    lang = first(b, "LETTER_LANG", "LANG")
    en = raw(lang).lower().startswith("en") if lang else is_english(" ".join(map(str, paras)))
    t = ({"to": "To:", "subject": "Application for the position of", "greet": "Dear Hiring Manager,",
          "close": "Kind regards,"} if en else
         {"to": "À l'attention de :", "subject": "Objet : Candidature au poste de",
          "greet": "Madame, Monsieur,", "close": "Bien cordialement,"})

    recipient = raw(first(b, "RECIPIENT_NAME"))
    company = raw(first(b, "COMPANY_NAME"))
    job = raw(first(b, "JOB_TITLE"))
    generic = recipient.lower() in ("", "madame, monsieur", "hiring manager", "madame, monsieur,")
    greeting = t["greet"] if generic else (f"Dear {recipient}," if en else f"{recipient},")

    right = []
    if recipient and not generic:
        right.append(rf"\textbf{{{t['to']}}} {tex(recipient)}")
    if company:
        right.append(rf"\textbf{{{tex(company)}}}")

    name = ENV["CV_NAME"]
    return "\n\n".join([
        r"\documentclass[11pt,a4paper]{article}",
        r"\usepackage[top=2cm,bottom=2cm,left=2.2cm,right=2.2cm]{geometry}",
        PREAMBLE % ("english" if en else "french"),
        r"\definecolor{primary}{RGB}{30,41,59}",
        r"\definecolor{secondary}{RGB}{71,85,105}",
        r"\pagestyle{empty}",
        r"\setlength{\parindent}{0pt}",
        r"\setlength{\parskip}{0.8em}",
        r"\begin{document}",
        rf"{{\Huge\bfseries\color{{primary}} {tex(name)}}}\\[0.3em]",
        r"{\small\color{secondary} " + contact_line(ENV["CV_LOCATION"], ENV["CV_EMAIL"], ENV["CV_PHONE"],
                                                     ENV["CV_GITHUB"], ENV["CV_LINKEDIN"]) + "}",
        r"\vspace{0.4cm}\hrule\vspace{0.4cm}",
        r"\today\par",
        (r"\begin{flushright}" + " \\\\\n".join(right) + r"\end{flushright}") if right else "",
        rf"\textbf{{\color{{primary}}{t['subject']} {tex(job)}}}" if job else "",
        r"\vspace{0.3cm}",
        tex(greeting),
        "\n\n".join(tex(p) for p in paras if raw(p)),
        r"\vspace{0.6cm}",
        t["close"],
        r"\vspace{0.3cm}",
        rf"\textbf{{{tex(name)}}}",
        r"\end{document}",
    ])


@app.post("/compile-cover-letter")
async def compile_cover_letter(body: Dict[str, Any] = Body(...), output: str = "pdf"):
    return pdf_response(compile_tex(render_letter(body), "cover_letter", "Lettre"),
                        "cover_letter_generated.pdf", output)