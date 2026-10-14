"""Settings from .env (docker-compose passes it to this container)."""
import os

# Identity: fallback for the CV contact line, and the sender of the cover letter
ENV = {k: os.getenv(k, "") for k in
       ["CV_NAME", "CV_LOCATION", "CV_EMAIL", "CV_PHONE", "CV_GITHUB", "CV_LINKEDIN"]}
