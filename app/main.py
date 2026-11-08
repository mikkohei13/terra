"""Terra — mobile-friendly observation entry for FinBIF."""

from __future__ import annotations

import os
from functools import wraps

from flask import (
    Flask,
    flash,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)

import config
from finbif.client import FinbifError, fetch_person, fetch_recent_observations
from finbif.document import Observation
from finbif.submit import submit_observations
from finbif.taxon import autocomplete_taxa, resolve_taxon

app = Flask(__name__)
app.secret_key = config.FLASK_SECRET_KEY
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = os.getenv("FLASK_ENV", "").lower() == "production"


@app.context_processor
def inject_user():
    return {
        "user_name": session.get("user_name"),
        "logged_in": bool(session.get("person_token")),
        "laji_auth_target": config.LAJI_AUTH_TARGET,
    }


def _request_is_localhost() -> bool:
    host = request.host.split(":", 1)[0].lower()
    return host in ("localhost", "127.0.0.1")


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("person_token"):
            flash("Kirjaudu sisään jatkaaksesi.", "error")
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped


@app.route("/")
def index():
    if not session.get("person_token"):
        return render_template("index.html", observations=None, fetch_error=None)

    observations = []
    fetch_error = None
    try:
        observations = fetch_recent_observations(session["person_token"], page_size=5)
    except FinbifError as exc:
        fetch_error = exc.message
    except Exception:
        fetch_error = "Havaintojen haku epäonnistui."

    return render_template(
        "index.html",
        observations=observations,
        fetch_error=fetch_error,
    )


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "GET":
        return render_template("login.html", error=None)

    if not _request_is_localhost():
        return (
            render_template(
                "login.html",
                error="Paikallinen kirjautuminen on käytössä vain localhostissa.",
            ),
            403,
        )

    person_token = (request.form.get("person_token") or "").strip()
    if not person_token:
        return render_template("login.html", error="Person token puuttuu."), 400

    try:
        person = fetch_person(person_token)
    except FinbifError as exc:
        return render_template("login.html", error=exc.message), 400
    except Exception:
        return (
            render_template("login.html", error="Kirjautuminen epäonnistui."),
            502,
        )

    person_id = (person.get("id") or "").strip()
    if not person_id:
        return (
            render_template(
                "login.html",
                error="Henkilötunnistetta ei löytynyt vastauksesta.",
            ),
            400,
        )

    session["person_token"] = person_token
    session["user_id"] = person_id
    session["user_name"] = (person.get("fullName") or person_id).strip()
    return redirect(url_for("index"), code=303)


@app.route("/logout", methods=["POST", "GET"])
def logout():
    session.clear()
    return redirect(url_for("index"), code=303)


@app.route("/api/taxa")
def api_taxa():
    if not session.get("person_token"):
        return jsonify({"error": "login required", "results": []}), 401
    query = (request.args.get("query") or "").strip()
    try:
        limit = min(max(int(request.args.get("limit") or 15), 1), 30)
    except ValueError:
        limit = 15
    try:
        results = autocomplete_taxa(
            query,
            limit=limit,
            person_token=session.get("person_token"),
        )
    except FinbifError as exc:
        return jsonify({"error": exc.message, "results": []}), 502
    return jsonify({"results": results})


@app.route("/observe", methods=["GET", "POST"])
@login_required
def observe():
    if request.method == "GET":
        return render_template("observe.html", form={}, error=None)

    form = {
        "taxon": (request.form.get("taxon") or "").strip(),
        "taxon_id": (request.form.get("taxon_id") or "").strip(),
        "date": (request.form.get("date") or "").strip(),
        "latitude": (request.form.get("latitude") or "").strip(),
        "longitude": (request.form.get("longitude") or "").strip(),
    }

    missing = []
    if not form["taxon"] and not form["taxon_id"]:
        missing.append("laji")
    if not form["date"]:
        missing.append("päivämäärä")
    if not form["latitude"]:
        missing.append("leveysaste")
    if not form["longitude"]:
        missing.append("pituusaste")
    if missing:
        return render_template(
            "observe.html",
            form=form,
            error=f"Pakolliset kentät puuttuvat: {', '.join(missing)}.",
        ), 400

    try:
        lat = float(form["latitude"].replace(",", "."))
        lon = float(form["longitude"].replace(",", "."))
    except ValueError:
        return render_template(
            "observe.html",
            form=form,
            error="Koordinaattien on oltava numeroita.",
        ), 400

    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return render_template(
            "observe.html",
            form=form,
            error="Koordinaatit eivät ole kelvollisia.",
        ), 400

    person_token = session["person_token"]
    try:
        if form["taxon_id"].startswith("MX."):
            taxon_id = form["taxon_id"]
            taxon_name = form["taxon"] or taxon_id
        else:
            taxon_id, taxon_name = resolve_taxon(
                form["taxon"],
                person_token=person_token,
            )
    except FinbifError as exc:
        return render_template("observe.html", form=form, error=exc.message), 400

    observation = Observation(
        taxon_id=taxon_id,
        taxon_name=taxon_name,
        date=form["date"],
        latitude=lat,
        longitude=lon,
    )

    try:
        result = submit_observations(
            [observation],
            person_token=person_token,
            observer_id=session["user_id"],
        )
    except FinbifError as exc:
        detail = ""
        if exc.details:
            detail = str(exc.details)
        return render_template(
            "result.html",
            ok=False,
            message=exc.message,
            details=detail,
            document_id=None,
        ), 400
    except ValueError as exc:
        return render_template("observe.html", form=form, error=str(exc)), 400

    return render_template(
        "result.html",
        ok=True,
        message="Havainto tallennettiin FinBIFiin.",
        details=None,
        document_id=result.get("document_id"),
    )


@app.errorhandler(404)
def not_found(_error):
    return render_template("simple.html", title="Ei löydy", content="Sivua ei löydy."), 404
