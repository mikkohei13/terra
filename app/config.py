import os

FLASK_SECRET_KEY = os.environ["FLASK_SECRET_KEY"]
FINBIF_API_TOKEN = os.environ["FINBIF_API_TOKEN"]
FINBIF_API_BASE = os.environ.get("FINBIF_API_BASE", "https://api.laji.fi").rstrip("/")

# Logged-out visitors are sent here.
HAVISTIN_URL = os.environ.get("HAVISTIN_URL", "https://havistin.biomi.org").rstrip("/")

# On for Cloud Run (set in the image). Local Docker Compose turns it off.
SESSION_COOKIE_SECURE = os.environ.get("SESSION_COOKIE_SECURE", "").strip().lower() in {
    "1",
    "true",
    "yes",
}

# Local /dev/login. Compose sets the flag. The token lives in .env.dev, which
# is not deployed; .env is.
DEV_LOGIN = os.environ.get("DEV_LOGIN", "").strip().lower() in {
    "1",
    "true",
    "yes",
}
DEV_PERSON_TOKEN = os.environ.get("DEV_PERSON_TOKEN", "").strip()

# Information system identifier for laji-auth (person tokens must be issued for this target).
LAJI_AUTH_TARGET = "KE.781"

# Vihko notebook (laji.fi) document envelope
VIHKO_COLLECTION_ID = "HR.1747"
VIHKO_FORM_ID = "JX.519"
