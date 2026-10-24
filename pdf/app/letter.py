"""The cover letter: render the AI's paragraphs in LaTeX."""
from fastapi import HTTPException

from .latex import PREAMBLE, compile_tex, contact_line
from .text import clean_keys, first, is_english, raw, tex


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

    # sender: the contact block of prompts/profile.md, added by the app
    me = b.get("personal_information") or {}
    name = first(me, "name", "full_name")
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
        r"{\small\color{secondary} " + contact_line(first(me, "location"), first(me, "email"), first(me, "phone"),
                                                     first(me, "github"), first(me, "linkedin")) + "}",
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


def build_letter_pdf(body: dict) -> bytes:
    return compile_tex(render_letter(body), "cover_letter", "Lettre")
