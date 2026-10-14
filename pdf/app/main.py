"""PDF service: JSON from the AI in, PDF out.

POST /compile-resume        CV, always exactly one page
POST /compile-cover-letter  cover letter
Add ?output=base64 to get {"pdf": "<base64>"} instead of the file (used by the app).
"""
import base64
from typing import Any, Dict
from urllib.parse import quote

from fastapi import Body, FastAPI, Response
from fastapi.responses import JSONResponse

from .letter import build_letter_pdf
from .resume import build_resume_pdf

app = FastAPI(title="PDF service")


def pdf_response(pdf: bytes, filename: str, output: str = "pdf") -> Response:
    if output == "base64":
        return JSONResponse({"pdf": base64.b64encode(pdf).decode()})
    return Response(content=pdf, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="{filename}"; filename*=UTF-8\'\'{quote(filename)}'})


@app.post("/compile-resume")
async def compile_resume(body: Dict[str, Any] = Body(...), output: str = "pdf"):
    return pdf_response(build_resume_pdf(body), "CV_generated.pdf", output)


@app.post("/compile-cover-letter")
async def compile_cover_letter(body: Dict[str, Any] = Body(...), output: str = "pdf"):
    return pdf_response(build_letter_pdf(body), "cover_letter_generated.pdf", output)
