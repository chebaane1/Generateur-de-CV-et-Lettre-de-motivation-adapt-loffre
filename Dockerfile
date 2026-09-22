FROM python:3.10-slim

# Installation de XeTeX et des polices requises
RUN apt-get update && apt-get install -y \
    texlive-xetex \
    texlive-fonts-recommended \
    texlive-plain-generic \
    && rm -rf /var/lib/apt/lists/*

# Installation de FastAPI et Uvicorn
RUN pip install --no-cache-dir fastapi uvicorn python-multipart

WORKDIR /app
COPY main.py .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
