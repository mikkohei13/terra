"""Terra — mobile-friendly observation entry for FinBIF."""

from __future__ import annotations

from functools import wraps

from flask import (
    Flask,
    abort,
    flash,
    jsonify,
    redirect,
    render_template,
    request,
    send_from_directory,
    session,
    url_for,
)

import config
from finbif import document as finbif_document
from interpret import InterpretError, InterpretUnavailable, interpret_notes
from finbif.client import FinbifError, fetch_person
from finbif.submit import submit_session
from finbif.taxon import (
    INFORMAL_TAXON_GROUPS,
    allowed_informal_taxon_groups,
    autocomplete_taxa,
    taxon_suggestion,
)

app = Flask(__name__)
app.secret_key = config.FLASK_SECRET_KEY
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = config.SESSION_COOKIE_SECURE
# A full submission is under 1 MB. Reject anything larger before it is read.
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024


@app.after_request
def _security_headers(response):
    # Leaflet writes style attributes to position panes and markers, so styles
    # cannot be limited to files. Scripts stay same-origin.
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' https://tile.openstreetmap.org; "
        "frame-ancestors 'none'; "
        "base-uri 'none'; "
        "form-action 'self'"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    # Browsers ignore this on the plain HTTP dev server. Cloud Run is HTTPS.
    response.headers["Strict-Transport-Security"] = "max-age=31536000"
    # Keeps a person token from leaking via Referer if one ever appears in a URL.
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


def client_config() -> dict:
    """Limits and taxon groups for the page. One place shared with JS and HTML."""
    return {
        "limits": {
            "routePoints": finbif_document.MAX_ROUTE_POINTS,
            "keywords": finbif_document.MAX_KEYWORDS,
            "keywordLength": finbif_document.MAX_KEYWORD_LENGTH,
            "locality": finbif_document.MAX_LOCALITY_LENGTH,
            "taxon": finbif_document.MAX_TAXON_LENGTH,
            "count": finbif_document.MAX_COUNT_LENGTH,
            "notes": finbif_document.MAX_NOTES_LENGTH,
            "accuracy": finbif_document.MAX_ACCURACY_M,
        },
        "defaultKeywords": list(finbif_document.DEFAULT_KEYWORDS),
        "informalTaxonGroups": [
            {"id": group["id"], "name": group["name"]}
            for group in INFORMAL_TAXON_GROUPS
        ],
    }


@app.context_processor
def inject_user():
    return {
        "logged_in": bool(session.get("person_token")),
        "person_name": session.get("person_name"),
        "person_id": session.get("person_id"),
        "havistin_url": config.HAVISTIN_URL,
        "client_config": client_config(),
    }


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("person_token"):
            flash("Log in to continue.", "error")
            return redirect(url_for("index"))
        return view(*args, **kwargs)

    return wrapped


def _person_token_from_request() -> str:
    # Form body only. A query parameter is stored in the Cloud Run request log.
    return (request.form.get("personToken") or "").strip()


def _person_token_rejected(exc: FinbifError) -> bool:
    code = (exc.error_code or "").upper()
    if "PERSON_TOKEN" in code:
        return True
    return "login is not valid" in (exc.message or "").lower()


def _error_status(exc: FinbifError) -> int:
    code = exc.status_code or 502
    if 400 <= code <= 599:
        return code
    return 502


def _api_error(exc: Exception, *, warning: str, failure: str, fallback: str):
    """JSON response for a FinBIF failure or an unexpected one."""
    if isinstance(exc, FinbifError):
        if _person_token_rejected(exc):
            session.clear()
            return jsonify({"message": exc.message, "loginRequired": True}), 401
        app.logger.warning("%s: %s %s", warning, exc.status_code, exc.error_code)
        payload = {"message": exc.message or fallback}
        if exc.details:
            payload["details"] = exc.details
        if exc.maybe_saved:
            payload["maybeSaved"] = True
        return jsonify(payload), _error_status(exc)
    app.logger.exception("%s", failure)
    return jsonify({"message": fallback}), 502


def _establish_session(person_token: str) -> None:
    person = fetch_person(person_token)
    person_id = (person.get("id") or "").strip()
    if not person_id:
        raise FinbifError("Person id was missing from the FinBIF response.")
    session.clear()
    session["person_token"] = person_token
    session["person_id"] = person_id
    session["person_name"] = (person.get("fullName") or person_id).strip()


@app.route("/favicon.ico")
def favicon():
    return send_from_directory(
        app.static_folder, "favicon.ico", mimetype="image/vnd.microsoft.icon"
    )


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/login", methods=["POST"])
def login():
    """Accept a person token from Havistin and start a Terra session.

    The token is the POST form field personToken. GET is rejected so the
    token cannot be written to the Cloud Run request log.
    """
    person_token = _person_token_from_request()
    if not person_token:
        if request.method == "POST":
            flash("Person token is missing.", "error")
        return redirect(url_for("index"), code=303)

    try:
        _establish_session(person_token)
    except FinbifError as exc:
        flash(exc.message, "error")
        return redirect(url_for("index"), code=303)
    except Exception:
        flash("Login failed.", "error")
        return redirect(url_for("index"), code=303)

    return redirect(url_for("index"), code=303)


def _dev_login_open() -> bool:
    """True only for local Compose. The same .env file is deployed to Cloud Run."""
    if not config.DEV_LOGIN:
        return False
    host = request.host.split(":", 1)[0].lower()
    return host in ("localhost", "127.0.0.1")


@app.route("/dev/login", methods=["GET"])
def dev_login():
    """Start a session from DEV_PERSON_TOKEN so a local browser can skip Havistin.

    The token stays on the server. A non-local host is rejected even if the
    flag is set, because .env is what Cloud Run receives.
    """
    if not _dev_login_open():
        abort(404)

    person_token = config.DEV_PERSON_TOKEN
    if not person_token:
        flash("Dev person token is missing.", "error")
        return redirect(url_for("index"), code=303)

    try:
        _establish_session(person_token)
    except FinbifError as exc:
        flash(exc.message, "error")
        return redirect(url_for("index"), code=303)
    except Exception:
        flash("Login failed.", "error")
        return redirect(url_for("index"), code=303)

    return redirect(url_for("index"), code=303)


@app.route("/api/sessions/submit", methods=["POST"])
def submit_session_route():
    """Build one FinBIF document from the phone's session and submit it."""
    person_token = session.get("person_token")
    observer_id = session.get("person_id")
    if not person_token or not observer_id:
        return jsonify({"message": "Log in to continue.", "loginRequired": True}), 401

    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"message": "The submission was empty."}), 400

    try:
        result = submit_session(body, person_token=person_token, observer_id=observer_id)
    except ValueError as exc:
        return jsonify({"message": str(exc)}), 400
    except Exception as exc:
        return _api_error(
            exc,
            warning="FinBIF submit failed",
            failure="Session submit failed",
            fallback="Submit failed.",
        )

    return jsonify({"documentId": result.get("document_id")})


@app.route("/api/observations/interpret", methods=["POST"])
def interpret_observation_route():
    """Fill count, sex, moving status, and plumage from notes. Stores nothing."""
    if not session.get("person_token"):
        return jsonify({"message": "Log in to continue.", "loginRequired": True}), 401

    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"message": "The observation was empty."}), 400
    taxon = body.get("taxon")
    notes = body.get("notes")
    if not isinstance(taxon, str) or not taxon.strip():
        return jsonify({"message": "A species name is required."}), 400
    if not isinstance(notes, str) or not notes.strip():
        return jsonify({"message": "Notes are required."}), 400

    try:
        result = interpret_notes(taxon.strip(), notes.strip())
    except InterpretUnavailable:
        app.logger.warning("Observation interpretation unavailable")
        return jsonify({"message": "Interpretation is unavailable."}), 503
    except InterpretError:
        app.logger.warning("Observation interpretation failed")
        return jsonify({"message": "Interpretation failed."}), 502
    except Exception:
        app.logger.exception("Observation interpretation failed")
        return jsonify({"message": "Interpretation failed."}), 502

    return jsonify(result)


@app.route("/api/taxa/autocomplete")
def autocomplete_taxa_route():
    """Proxy FinBIF taxon autocomplete. The browser never calls api.laji.fi."""
    if not session.get("person_token"):
        return jsonify({"message": "Log in to continue.", "loginRequired": True}), 401

    groups = allowed_informal_taxon_groups(request.args.get("informalTaxonGroups"))
    try:
        rows = autocomplete_taxa(
            request.args.get("query") or "",
            limit=10,
            informal_taxon_groups=groups,
        )
    except Exception as exc:
        return _api_error(
            exc,
            warning="FinBIF taxon autocomplete failed",
            failure="Taxon autocomplete failed",
            fallback="Taxon search failed.",
        )

    results = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        suggestion = taxon_suggestion(row)
        if suggestion:
            results.append(suggestion)
    return jsonify({"results": results})


@app.route("/logout", methods=["POST"])
def logout():
    # Clears Terra's cookie only. The person token is shared with Havistin,
    # so it must not be revoked here.
    session.clear()
    return redirect(url_for("index"), code=303)


@app.errorhandler(413)
def request_too_large(_error):
    # JSON, so the phone does not treat a rejected submit as maybe already saved.
    message = "The submission is too large."
    if request.path.startswith("/api/"):
        return jsonify({"message": message}), 413
    return render_template("simple.html", title="Too large", content=message), 413


@app.errorhandler(404)
def not_found(_error):
    return render_template("simple.html", title="Not found", content="Page not found."), 404
