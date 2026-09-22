import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import List, Optional
from urllib.parse import quote
from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel

app = FastAPI()

CV_NAME = os.getenv("CV_NAME", "YOUR_NAME")
CV_LOCATION = os.getenv("CV_LOCATION", "YOUR_CITY, YOUR_COUNTRY")
CV_EMAIL = os.getenv("CV_EMAIL", "your.email@example.com")
CV_GITHUB = os.getenv("CV_GITHUB", "github.com/your-account")
CV_LINKEDIN = os.getenv("CV_LINKEDIN", "linkedin.com/in/your-profile")
CV_COMPANY_1 = os.getenv("CV_COMPANY_1", "YOUR_COMPANY_1")
CV_COMPANY_2 = os.getenv("CV_COMPANY_2", "YOUR_COMPANY_2")
CV_COMPANY_3 = os.getenv("CV_COMPANY_3", "YOUR_COMPANY_3")
CV_PROJECT_URL = os.getenv("CV_PROJECT_URL", "your-project.example.com")
CV_SCHOOL = os.getenv("CV_SCHOOL", "YOUR_SCHOOL")
CV_SECONDARY_SCHOOL = os.getenv("CV_SECONDARY_SCHOOL", "YOUR_SECONDARY_SCHOOL")
CV_DISTINCTION = os.getenv("CV_DISTINCTION", "YOUR_DISTINCTION")
CV_COMMUNITY = os.getenv("CV_COMMUNITY", "YOUR_TECH_COMMUNITY")

LATEX_TEMPLATE = r"""
\documentclass[10pt, a4paper]{article}
\usepackage[a4paper, left=1.5cm, right=1.5cm, top=1.5cm, bottom=1.5cm]{geometry}
\usepackage{fontspec}
\usepackage{polyglossia}
\setdefaultlanguage{french}
\usepackage{hyperref}
\usepackage{enumitem}
\usepackage{titlesec}
\usepackage{xcolor}
\usepackage{setspace}

\setstretch{1.15}
\definecolor{primary}{RGB}{33, 37, 41}
\definecolor{linkcolor}{RGB}{30, 80, 160}

\hypersetup{
    colorlinks=true,
    linkcolor=linkcolor,
    urlcolor=linkcolor,
    pdfauthor={{{ CV_NAME }}},
    pdftitle={CV - {{ CV_NAME }} - Data Engineer}
}

\pagestyle{empty}
\setlength{\parindent}{0pt}
\setlength{\parskip}{0pt}

\titleformat{\section}{\large\bfseries\scshape\color{primary}}{}{0em}{}[\titlerule]
\titlespacing*{\section}{0pt}{10pt}{5pt}

\setlist[itemize]{leftmargin=1.2em, labelsep=0.4em, topsep=2pt, itemsep=3pt, parsep=1pt}

\begin{document}

\begin{center}
    {\Huge \bfseries \scshape {{ CV_NAME }}} \\[3pt]
    \small {{ CV_LOCATION }} ~$\diamond$~ {{ CV_EMAIL }} ~$\diamond$~ {{ CV_GITHUB }} ~$\diamond$~ {{ CV_LINKEDIN }}
\end{center}

\vspace{-4pt}

\section*{Profil}
{{ PROFILE_SUMMARY }}

\section*{Compétences}
\begin{itemize}[leftmargin=0pt, label={}]
    \item \textbf{Gouvernance \& Data Management :} {{ SKILLS_GOVERNANCE }}
    \item \textbf{Data Engineering \& Automation :} {{ SKILLS_DATA_ENG }}
    \item \textbf{Langages \& Frameworks :} {{ SKILLS_LANGUAGES_FRAMEWORKS }}
    \item \textbf{Langues :} Français : Maternelle ~$\diamond$~ Anglais : C1 ~$\diamond$~ Arabe : Maternelle ~$\diamond$~ Italien : B1
\end{itemize}

\section*{Expérience Professionnelle}

\textbf{Data Engineer (Stage)} \hfill Juin 2026 -- Août 2026 \\
	extit{{{ CV_COMPANY_1 }}} \hfill \textit{{{ CV_LOCATION }}}
{{ EXP_TEAMWILL }}

\vspace{3pt}

\textbf{Data Engineer / Développeur Python (Temps partiel)} \hfill Jan 2023 -- Juin 2026 \\
	extit{{{ CV_COMPANY_2 }}} \hfill \textit{{{ CV_LOCATION }}}
{{ EXP_NINGEN }}

\vspace{3pt}

\textbf{Data Science (Stage)} \hfill Juin 2023 -- Juil 2023 \\
	extit{{{ CV_COMPANY_3 }}} \hfill \textit{{{ CV_LOCATION }}}
{{ EXP_BIAT }}

\begin{samepage}
\section*{Projets}
	extbf{YOUR_PROJECT_NAME} (\href{https://{{ CV_PROJECT_URL }}}{{ CV_PROJECT_URL }}) -- \textit{Projet SaaS B2B}
\begin{itemize}
    \item Création d'un outil SaaS générant des photos de mannequins IA à partir d'une simple photo de vêtement.
    \item Conduite de campagnes Outbound B2B, itérations basées sur les retours utilisateurs : acquisition de 50 utilisateurs actifs et conversion de 2 clients payants.
\end{itemize}

\vspace{2pt}

\textbf{Data Warehouse Medallion Architecture} -- \textit{Projet Technique}
\begin{itemize}
    \item Conception d'un Data Warehouse académique de bout en bout structuré en couches Bronze, Silver et Gold pour optimiser le reporting analytique.
\end{itemize}

{{ CUSTOM_PROJECT_BLOCK }}
\end{samepage}

\section*{Formation \& Certifications}
\textbf{Diplôme d'Ingénieur en Informatique} (Option Data Engineering) \hfill Diplôme prévu : Fév 2027 \\
	extit{{{ CV_SCHOOL }}} \hfill \textit{{{ CV_LOCATION }}}

\vspace{2pt}
\textbf{Baccalauréat Français} (Spécialité Mathématiques \& Économie) \hfill 2013 -- 2022 \\
	extit{{{ CV_SECONDARY_SCHOOL }}}

\vspace{2pt}
\textbf{Préparation à la Certification :} Microsoft Azure Databricks Data Engineer Associate (DP-750)

\section*{Engagement \& Distinctions}
\begin{itemize}
    \item \textbf{{{ CV_DISTINCTION }}} : YOUR_DISTINCTION_DESCRIPTION
    \item \textbf{{{ CV_COMMUNITY }}} : YOUR_COMMUNITY_DESCRIPTION
\end{itemize}

\end{document}
"""

class ResumeData(BaseModel):
    PROFILE_SUMMARY: str
    SKILLS_LIST: Optional[str] = ""
    SKILLS_GOVERNANCE: Optional[str] = ""
    SKILLS_DATA_ENG: Optional[str] = ""
    SKILLS_LANGUAGES_FRAMEWORKS: Optional[str] = ""
    EXP_TEAMWILL: Optional[List[str]] = []
    EXP_NINGEN: Optional[List[str]] = []
    EXP_BIAT: Optional[List[str]] = []
    # Nouveaux champs pour le projet choisi par l'IA
    CUSTOM_PROJECT_TITLE: Optional[str] = ""
    CUSTOM_PROJECT_DESC: Optional[str] = ""

def sanitize_latex(text: str) -> str:
    if not isinstance(text, str):
        return ""
    replacements = {
        "\\": r"\textbackslash{}",
        "%": r"\%",
        "&": r"\&",
        "_": r"\_",
        "#": r"\#",
        "$": r"\$",
        "{": r"\{",
        "}": r"\}",
        "~": r"\textasciitilde{}",
        "^": r"\textasciicircum{}",
    }
    for key, val in replacements.items():
        text = text.replace(key, val)
    return text

def format_items(items: List[str]) -> str:
    if not items:
        return ""
    formatted = [f"    \\item {sanitize_latex(item)}" for item in items]
    return "\\begin{itemize}\n" + "\n".join(formatted) + "\n\\end{itemize}"

def render_identity(template: str) -> str:
    identity = {
        "{{ CV_NAME }}": CV_NAME,
        "{{ CV_LOCATION }}": CV_LOCATION,
        "{{ CV_EMAIL }}": CV_EMAIL,
        "{{ CV_GITHUB }}": CV_GITHUB,
        "{{ CV_LINKEDIN }}": CV_LINKEDIN,
        "{{ CV_COMPANY_1 }}": CV_COMPANY_1,
        "{{ CV_COMPANY_2 }}": CV_COMPANY_2,
        "{{ CV_COMPANY_3 }}": CV_COMPANY_3,
        "{{ CV_PROJECT_URL }}": CV_PROJECT_URL,
        "{{ CV_SCHOOL }}": CV_SCHOOL,
        "{{ CV_SECONDARY_SCHOOL }}": CV_SECONDARY_SCHOOL,
        "{{ CV_DISTINCTION }}": CV_DISTINCTION,
        "{{ CV_COMMUNITY }}": CV_COMMUNITY,
    }
    for placeholder, value in identity.items():
        template = template.replace(placeholder, sanitize_latex(value))
    return template

@app.post("/compile-resume")
async def compile_resume(data: ResumeData):
    tex_content = render_identity(LATEX_TEMPLATE)
    
    # Remplacement des textes
    tex_content = tex_content.replace("{{ PROFILE_SUMMARY }}", sanitize_latex(data.PROFILE_SUMMARY))
    tex_content = tex_content.replace("{{ SKILLS_GOVERNANCE }}", sanitize_latex(data.SKILLS_GOVERNANCE))
    tex_content = tex_content.replace("{{ SKILLS_DATA_ENG }}", sanitize_latex(data.SKILLS_DATA_ENG))
    tex_content = tex_content.replace("{{ SKILLS_LANGUAGES_FRAMEWORKS }}", sanitize_latex(data.SKILLS_LANGUAGES_FRAMEWORKS))
    
    # Injection dynamique du projet personnalisé si fourni par l'IA
    if data.CUSTOM_PROJECT_TITLE and data.CUSTOM_PROJECT_DESC:
        custom_block = f"\\vspace{{2pt}}\n\n\\textbf{{{sanitize_latex(data.CUSTOM_PROJECT_TITLE)}}} -- \\textit{{Projet Spécifique}}\n\\begin{{itemize}}\n    \\item {sanitize_latex(data.CUSTOM_PROJECT_DESC)}\n\\end{{itemize}}"
        tex_content = tex_content.replace("{{ CUSTOM_PROJECT_BLOCK }}", custom_block)
    else:
        tex_content = tex_content.replace("{{ CUSTOM_PROJECT_BLOCK }}", "")

    # Expériences
    tex_content = tex_content.replace("{{ EXP_TEAMWILL }}", format_items(data.EXP_TEAMWILL))
    tex_content = tex_content.replace("{{ EXP_NINGEN }}", format_items(data.EXP_NINGEN))
    tex_content = tex_content.replace("{{ EXP_BIAT }}", format_items(data.EXP_BIAT))

    with tempfile.TemporaryDirectory() as temp_dir:
        tex_file = os.path.join(temp_dir, "document.tex")
        pdf_file = os.path.join(temp_dir, "document.pdf")
        log_file = os.path.join(temp_dir, "document.log")

        with open(tex_file, "w", encoding="utf-8") as f:
            f.write(tex_content)

        compile_cmd = [
            "xelatex",
            "-interaction=nonstopmode",
            "-halt-on-error",
            f"-output-directory={temp_dir}",
            tex_file
        ]

        subprocess.run(compile_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        subprocess.run(compile_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        if not os.path.exists(pdf_file):
            error_log = "Erreur de compilation inconnue."
            if os.path.exists(log_file):
                with open(log_file, "r", encoding="utf-8", errors="ignore") as f:
                    lines = f.readlines()
                    errors = [l.strip() for l in lines if l.startswith("!")]
                    if errors:
                        error_log = "\n".join(errors[:5])

            raise HTTPException(status_code=422, detail=f"Échec XeLaTeX :\n{error_log}")

        with open(pdf_file, "rb") as f:
            pdf_bytes = f.read()

    filename = "CV_generated.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"; filename*=UTF-8\'\'{quote(filename)}'
        }
    )



# --- NOUVEAU MODÈLE ET TEMPLATE POUR LA LETTRE DE MOTIVATION ---

COVER_LETTER_TEMPLATE = r"""
\documentclass[11pt,a4paper]{article}

% --- PACKAGES DE BASE & POLICES ---
\usepackage[top=2cm, bottom=2cm, left=2.2cm, right=2.2cm]{geometry}
\usepackage{fontspec}
\usepackage{polyglossia}
\setdefaultlanguage{french}

\usepackage{xcolor}
\usepackage{hyperref}
\usepackage{enumitem}

% --- COULEURS ET STYLES ---
\definecolor{primary}{RGB}{30, 41, 59}       % Bleu nuit / Slate
\definecolor{secondary}{RGB}{71, 85, 105}    % Gris discret
\definecolor{accent}{RGB}{37, 99, 235}       % Bleu accentuation

\hypersetup{
    colorlinks=true,
    linkcolor=accent,
    urlcolor=accent,
    pdfauthor={{{ CV_NAME }}},
    pdftitle={Lettre de Motivation - {{ CV_NAME }}}
}

\pagestyle{empty}
\setlength{\parindent}{0pt}
\setlength{\parskip}{0.8em}

% Configuration des puces pour la section VALUE si liste à puces utilisée
\setlist[itemize]{
    leftmargin=*,
    label=\small$\blacksquare$,
    itemsep=0.3em,
    topsep=0.2em,
    partopsep=0pt,
    parsep=0pt
}

\begin{document}

% --- EN-TÊTE ---
{\Huge \bfseries \color{primary} {{ CV_NAME }}} \\[0.3em]
{\small \color{secondary} {{ CV_LOCATION }} \quad$\cdot$\quad \href{mailto:{{ CV_EMAIL }}}{{ CV_EMAIL }} \quad$\cdot$\quad \href{https://{{ CV_GITHUB }}}{{ CV_GITHUB }} \quad$\cdot$\quad \href{https://{{ CV_LINKEDIN }}}{{ CV_LINKEDIN }}}

\vspace{0.6cm}
\rule{\textwidth}{0.6pt}
\vspace{0.4cm}

% --- METADATÉ & DESTINATAIRE ---
\textbf{\today} \hfill \textbf{À l'attention de :} {{ RECIPIENT_NAME }} \\
\null \hfill \textbf{{{ COMPANY_NAME }}}

\vspace{0.6cm}

\textbf{\color{primary}Objet : Candidature au poste de {{ JOB_TITLE }}}

\vspace{0.4cm}

Madame, Monsieur,

% Paragraphe 1 : L'Accroche (HOOK)
{{ PARAGRAPH_HOOK }}

% Paragraphe 2 : La Preuve & Valeur Ajoutée (VALUE)
{{ PARAGRAPH_VALUE }}

% Paragraphe 3 : Alignement & Vision (ALIGNMENT)
{{ PARAGRAPH_ALIGNMENT }}

% Paragraphe 4 : Appel à l'action (CTA)
{{ PARAGRAPH_CTA }}

\vspace{0.8cm}

Bien cordialement,

\vspace{0.4cm}
	extbf{{{ CV_NAME }}}

\end{document}
"""

class CoverLetterData(BaseModel):
    COMPANY_NAME: Optional[str] = "L'équipe de Recrutement"
    JOB_TITLE: str
    RECIPIENT_NAME: Optional[str] = "Madame, Monsieur"
    PARAGRAPH_HOOK: str
    PARAGRAPH_VALUE: str
    PARAGRAPH_ALIGNMENT: str
    PARAGRAPH_CTA: str


@app.post("/compile-cover-letter")
async def compile_cover_letter(data: CoverLetterData):
    tex_content = render_identity(COVER_LETTER_TEMPLATE)

    # Remplacement des variables avec désinfection LaTeX
    tex_content = tex_content.replace("{{ COMPANY_NAME }}", sanitize_latex(data.COMPANY_NAME))
    tex_content = tex_content.replace("{{ JOB_TITLE }}", sanitize_latex(data.JOB_TITLE))
    tex_content = tex_content.replace("{{ RECIPIENT_NAME }}", sanitize_latex(data.RECIPIENT_NAME))
    tex_content = tex_content.replace("{{ PARAGRAPH_HOOK }}", sanitize_latex(data.PARAGRAPH_HOOK))
    tex_content = tex_content.replace("{{ PARAGRAPH_VALUE }}", sanitize_latex(data.PARAGRAPH_VALUE))
    tex_content = tex_content.replace("{{ PARAGRAPH_ALIGNMENT }}", sanitize_latex(data.PARAGRAPH_ALIGNMENT))
    tex_content = tex_content.replace("{{ PARAGRAPH_CTA }}", sanitize_latex(data.PARAGRAPH_CTA))

    with tempfile.TemporaryDirectory() as temp_dir:
        tex_file = os.path.join(temp_dir, "cover_letter.tex")
        pdf_file = os.path.join(temp_dir, "cover_letter.pdf")
        log_file = os.path.join(temp_dir, "cover_letter.log")

        with open(tex_file, "w", encoding="utf-8") as f:
            f.write(tex_content)

        compile_cmd = [
            "xelatex",
            "-interaction=nonstopmode",
            "-halt-on-error",
            f"-output-directory={temp_dir}",
            tex_file
        ]

        # Double passage pour la stabilisation de la mise en page
        subprocess.run(compile_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        subprocess.run(compile_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        if not os.path.exists(pdf_file):
            error_log = "Erreur de compilation inconnue."
            if os.path.exists(log_file):
                with open(log_file, "r", encoding="utf-8", errors="ignore") as f:
                    lines = f.readlines()
                    errors = [l.strip() for l in lines if l.startswith("!")]
                    if errors:
                        error_log = "\n".join(errors[:5])

            raise HTTPException(status_code=422, detail=f"Échec XeLaTeX (Lettre) :\n{error_log}")

        with open(pdf_file, "rb") as f:
            pdf_bytes = f.read()

    filename = "cover_letter_generated.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"; filename*=UTF-8\'\'{quote(filename)}'
        }
    )