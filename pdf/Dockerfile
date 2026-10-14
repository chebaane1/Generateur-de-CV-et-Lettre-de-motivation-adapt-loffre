FROM python:3.10-slim

# XeLaTeX + fonts (texlive-fonts-recommended brings TeX Gyre Termes, the Times-like font of the CV).
# Keep the recommended packages: without them the TeX font index isn't set up and the font isn't found.
RUN apt-get update && apt-get install -y \
    texlive-xetex \
    texlive-fonts-recommended \
    texlive-plain-generic \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
