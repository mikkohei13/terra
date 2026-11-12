"""Terra — mobile-friendly observation entry for FinBIF."""

from __future__ import annotations

from functools import wraps

from flask import Flask, abort, flash, jsonify, redirect, render_template, request, session, url_for

import config
from finbif.client import FinbifError, fetch_person
from finbif.submit import submit_session

app = Flask(__name__)
app.secret_key = config.FLASK_SECRET_KEY
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = config.SESSION_COOKIE_SECURE


@app.after_request
def _referrer_policy(response):
    # Keeps a person token from leaking via Referer if one ever appears in a URL.
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@app.context_processor
def inject_user():
    return {
        "logged_in": bool(session.get("person_token")),
        "person_name": session.get("person_name"),
        "person_id": session.get("person_id"),
        "havistin_url": config.HAVISTIN_URL,
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


def _establish_session(person_token: str) -> None:
    person = fetch_person(person_token)
    person_id = (person.get("id") or "").strip()
    if not person_id:
        raise FinbifError("Person id was missing from the FinBIF response.")
    session.clear()
    session["person_token"] = person_token
    session["person_id"] = person_id
    session["person_name"] = (person.get("fullName") or person_id).strip()


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
    except FinbifError as exc:
        if _person_token_rejected(exc):
            session.clear()
            return jsonify({"message": exc.message, "loginRequired": True}), 401
        app.logger.warning("FinBIF submit failed: %s %s", exc.status_code, exc.error_code)
        payload = {"message": exc.message or "Submit failed."}
        if exc.details:
            payload["details"] = exc.details
        return jsonify(payload), _error_status(exc)
    except Exception:
        app.logger.exception("Session submit failed")
        return jsonify({"message": "Submit failed."}), 502

    return jsonify({"documentId": result.get("document_id")})


@app.route("/logout", methods=["POST"])
def logout():
    # Clears Terra's cookie only. The person token is shared with Havistin,
    # so it must not be revoked here.
    session.clear()
    return redirect(url_for("index"), code=303)


@app.errorhandler(404)
def not_found(_error):
    return render_template("simple.html", title="Not found", content="Page not found."), 404
