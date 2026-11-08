"""Terra — mobile-friendly observation entry for FinBIF."""

from __future__ import annotations

from functools import wraps

from flask import Flask, flash, redirect, render_template, request, session, url_for

import config
from finbif.client import FinbifError, fetch_person

app = Flask(__name__)
app.secret_key = config.FLASK_SECRET_KEY
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = config.SESSION_COOKIE_SECURE


@app.after_request
def _referrer_policy(response):
    # Keeps a person token in /login?personToken=... from leaking via Referer.
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


def _request_is_localhost() -> bool:
    host = request.host.split(":", 1)[0].lower()
    return host in ("localhost", "127.0.0.1")


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("person_token"):
            flash("Log in to continue.", "error")
            return redirect(url_for("index"))
        return view(*args, **kwargs)

    return wrapped


def _person_token_from_request() -> str:
    return (request.values.get("personToken") or "").strip()


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
    return render_template(
        "index.html",
        show_token_form=_request_is_localhost() and not session.get("person_token"),
    )


@app.route("/login", methods=["GET", "POST"])
def login():
    """Accept a person token from Havistin and start a Terra session.

    POST form field personToken is the normal path. GET is accepted too,
    then redirected so the token does not remain in the address bar.
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


@app.route("/logout", methods=["POST"])
def logout():
    # Clears Terra's cookie only. The person token is shared with Havistin,
    # so it must not be revoked here.
    session.clear()
    return redirect(url_for("index"), code=303)


@app.errorhandler(404)
def not_found(_error):
    return render_template("simple.html", title="Not found", content="Page not found."), 404
