"""The CV: normalize the AI's JSON, render it in LaTeX, fit it on exactly one page."""
from fastapi import HTTPException

from .latex import PREAMBLE, compile_tex_pages, github_link, itemize, linkedin_link, bold_terms
from .text import as_list, clean_keys, first, is_english, raw, tex, tex_url

# Font sizes tried to fill exactly one page (the largest that fits wins)
FONT_SIZES = [9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5]


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
        "name": first(pi, "name", "full_name"),
        "headline": first(b, "HEADLINE") or first(pi, "title", "label"),
        "email": first(pi, "email"),
        "phone": first(pi, "phone"),
        "github": first(pi, "github"),
        "linkedin": first(pi, "linkedin"),
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


def build_resume_pdf(body: dict) -> bytes:
    """One full page: start at 11 pt, grow while it fits, shrink if it overflows."""
    d = normalize_resume(body)
    i = FONT_SIZES.index(11)
    pdf, pages = compile_tex_pages(render_resume(d, FONT_SIZES[i]), "resume", "CV")
    step = 1 if pages <= 1 else -1
    while 0 <= i + step < len(FONT_SIZES):
        nxt_pdf, nxt_pages = compile_tex_pages(render_resume(d, FONT_SIZES[i + step]), "resume", "CV")
        if step > 0 and nxt_pages > 1:
            break                      # one size too big: keep the last one that fit
        i, pdf, pages = i + step, nxt_pdf, nxt_pages
        if step < 0 and pages <= 1:
            break                      # first size small enough
    return pdf
