"""Build a FinBIF Vihko document from one field session.

The gathering is the route: a LineString, or a Point when only one position
remains. With no route points it is the session start. Each observation is a
species name, an optional count, optional notes, a time, and its own point.
Older observations without a point use the session point.

A new observation field is read in _parse_observation and mapped in
_build_unit. A document-level field, such as keywords, is read in
_parse_header and written in build_document. Unknown keys are ignored.
A chosen taxon id is sent as unitFact.autocompleteSelectedTaxonID.
Count is sent as unit.count and notes as unit.notes. Blank values are left out.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Optional

import config
from finbif.taxon import normalize_taxon_id

_STAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")
_MAX_OBSERVATIONS = 300
_MAX_ROUTE_POINTS = 2000
_MAX_TAXON_LENGTH = 300
_MAX_COUNT_LENGTH = 300
_MAX_NOTES_LENGTH = 2000
_MAX_KEYWORDS = 30
_MAX_KEYWORD_LENGTH = 100
_DEFAULT_KEYWORDS = ("new",)


def _stamp(value: Any, label: str) -> str:
    text = str(value or "").strip()
    if not _STAMP.fullmatch(text):
        raise ValueError(f"{label} must be in the form YYYY-MM-DDTHH:mm.")
    try:
        datetime.strptime(text, "%Y-%m-%dT%H:%M")
    except ValueError:
        raise ValueError(f"{label} is not a real date.") from None
    return text


def _coordinate(value: Any, label: str, low: float, high: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} is missing.")
    number = float(value)
    if number != number or number in (float("inf"), float("-inf")):
        raise ValueError(f"{label} is missing.")
    if not low <= number <= high:
        raise ValueError(f"{label} is out of range.")
    return round(number, 6)


def _point(latitude: float, longitude: float) -> dict[str, Any]:
    # GeoJSON order is longitude, latitude.
    return {"type": "Point", "coordinates": [longitude, latitude]}


def _parse_points(raw_session: dict[str, Any]) -> list[tuple[float, float]]:
    raw_points = raw_session.get("points", [])
    if raw_points is None:
        return []
    if not isinstance(raw_points, list):
        raise ValueError("Route points must be a list.")
    if len(raw_points) > _MAX_ROUTE_POINTS:
        raise ValueError(f"A route can contain at most {_MAX_ROUTE_POINTS} points.")
    points: list[tuple[float, float]] = []
    for raw in raw_points:
        if not isinstance(raw, dict):
            raise ValueError("A route point is missing.")
        points.append(
            (
                _coordinate(raw.get("lat"), "Route latitude", -90, 90),
                _coordinate(raw.get("lon"), "Route longitude", -180, 180),
            )
        )
    return points


def _gathering_geometry(session: dict[str, Any]) -> dict[str, Any]:
    """LineString of the route, or a Point when fewer than two positions remain."""
    coordinates: list[list[float]] = []
    for latitude, longitude in session["points"]:
        pair = [longitude, latitude]
        if coordinates and coordinates[-1] == pair:
            continue
        coordinates.append(pair)
    if len(coordinates) >= 2:
        return {"type": "LineString", "coordinates": coordinates}
    if len(coordinates) == 1:
        return {"type": "Point", "coordinates": coordinates[0]}
    return _point(session["lat"], session["lon"])


def _observation_point(
    raw: dict[str, Any],
    session_lat: float,
    session_lon: float,
) -> tuple[float, float]:
    """Pin coordinates, or the session point when the observation has none."""
    has_lat = raw.get("lat") is not None
    has_lon = raw.get("lon") is not None
    if not has_lat and not has_lon:
        return session_lat, session_lon
    return (
        _coordinate(raw.get("lat"), "Observation latitude", -90, 90),
        _coordinate(raw.get("lon"), "Observation longitude", -180, 180),
    )


def _build_unit(obs: dict[str, Any]) -> dict[str, Any]:
    unit: dict[str, Any] = {
        "identifications": [{"taxon": obs["taxon"]}],
        "unitGathering": {
            "geometry": _point(obs["lat"], obs["lon"]),
            "dateBegin": obs["at"],
        },
        "taxonConfidence": "MY.taxonConfidenceSure",
        "recordBasis": "MY.recordBasisHumanObservation",
    }
    if obs.get("count"):
        unit["count"] = obs["count"]
    if obs.get("notes"):
        unit["notes"] = obs["notes"]
    taxon_id = obs.get("taxonId")
    if taxon_id:
        unit["unitFact"] = {"autocompleteSelectedTaxonID": taxon_id}
    return unit


def _optional_text(value: Any, label: str, max_length: int) -> Optional[str]:
    """Empty means the field is absent. Anything else must be text."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{label} must be text.")
    text = value.strip()
    if not text:
        return None
    if len(text) > max_length:
        raise ValueError(f"{label} is too long.")
    return text


def _taxon_id(value: Any) -> Optional[str]:
    """Empty means no chosen taxon. Anything else must be an MX id."""
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    taxon_id = normalize_taxon_id(value)
    if not taxon_id:
        raise ValueError("A taxon id is not valid.")
    return taxon_id


def _parse_observation(
    raw: Any,
    index: int,
    session_lat: float,
    session_lon: float,
) -> dict[str, Any]:
    """Read one posted observation. Unknown keys are ignored.

    A new observation field is read here and mapped in _build_unit.
    """
    if not isinstance(raw, dict):
        raise ValueError("An observation is missing its species name.")
    taxon = str(raw.get("taxon") or "").strip()
    if not taxon:
        raise ValueError("Each observation needs a species name.")
    if len(taxon) > _MAX_TAXON_LENGTH:
        raise ValueError("A species name is too long.")
    seq = raw.get("seq")
    if not isinstance(seq, int):
        seq = index
    latitude, longitude = _observation_point(raw, session_lat, session_lon)
    observation = {
        "seq": seq,
        "taxon": taxon,
        "at": _stamp(raw.get("at"), "Observation time"),
        "lat": latitude,
        "lon": longitude,
    }
    taxon_id = _taxon_id(raw.get("taxonId"))
    if taxon_id:
        observation["taxonId"] = taxon_id
    count = _optional_text(raw.get("count"), "Count", _MAX_COUNT_LENGTH)
    if count:
        observation["count"] = count
    notes = _optional_text(raw.get("notes"), "Notes", _MAX_NOTES_LENGTH)
    if notes:
        observation["notes"] = notes
    return observation


def _parse_keywords(value: Any) -> list[str]:
    if value is None:
        return list(_DEFAULT_KEYWORDS)
    if not isinstance(value, list):
        raise ValueError("Keywords must be a list.")
    if len(value) > _MAX_KEYWORDS:
        raise ValueError(f"A document can contain at most {_MAX_KEYWORDS} keywords.")
    keywords: list[str] = []
    for item in value:
        if not isinstance(item, str):
            raise ValueError("A keyword must be text.")
        text = item.strip()
        if not text:
            raise ValueError("A keyword is empty.")
        if len(text) > _MAX_KEYWORD_LENGTH:
            raise ValueError("A keyword is too long.")
        keywords.append(text)
    return keywords


def _parse_header(body: dict[str, Any]) -> dict[str, Any]:
    """Read optional document details. Unknown keys are ignored.

    A new document-level field is read here and written in build_document.
    Missing keywords stay ["new"].
    """
    raw = body.get("document")
    if raw is None:
        return {"keywords": list(_DEFAULT_KEYWORDS)}
    if not isinstance(raw, dict):
        raise ValueError("Document details must be an object.")
    return {"keywords": _parse_keywords(raw.get("keywords"))}


def parse_submission(
    body: dict[str, Any],
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    """Validate the JSON body from the phone. Raises ValueError with a short message."""
    raw_session = body.get("session")
    raw_observations = body.get("observations")
    if not isinstance(raw_session, dict):
        raise ValueError("Session data is missing.")
    if not isinstance(raw_observations, list):
        raise ValueError("Observations must be a list.")
    if not raw_observations:
        raise ValueError("Add at least one observation before ending the session.")
    if len(raw_observations) > _MAX_OBSERVATIONS:
        raise ValueError(f"A session can contain at most {_MAX_OBSERVATIONS} observations.")

    session = {
        "startedAt": _stamp(raw_session.get("startedAt"), "Session start"),
        "endedAt": _stamp(raw_session.get("endedAt"), "Session end"),
        "lat": _coordinate(raw_session.get("lat"), "Latitude", -90, 90),
        "lon": _coordinate(raw_session.get("lon"), "Longitude", -180, 180),
        "points": _parse_points(raw_session),
    }
    if session["endedAt"] < session["startedAt"]:
        session["endedAt"] = session["startedAt"]

    indexed: list[tuple[int, dict[str, Any]]] = []
    for index, raw in enumerate(raw_observations):
        observation = _parse_observation(raw, index, session["lat"], session["lon"])
        indexed.append((index, observation))

    indexed.sort(key=lambda item: (item[1]["seq"], item[0]))
    observations = [item[1] for item in indexed]
    return session, observations, _parse_header(body)


def build_document(
    session: dict[str, Any],
    observations: list[dict[str, Any]],
    observer_id: str,
    header: dict[str, Any],
) -> dict[str, Any]:
    """One document, one gathering, one unit per observation."""
    observer_id = (observer_id or "").strip()
    if not observer_id:
        raise ValueError("Observer id is missing.")
    if not observations:
        raise ValueError("Add at least one observation before ending the session.")

    gathering = {
        "geometry": _gathering_geometry(session),
        "units": [_build_unit(obs) for obs in observations],
    }
    return {
        "collectionID": config.VIHKO_COLLECTION_ID,
        "formID": config.VIHKO_FORM_ID,
        "keywords": list(header["keywords"]),
        "secureLevel": "MX.secureLevelNone",
        "gatheringEvent": {
            "dateBegin": session["startedAt"],
            "dateEnd": session["endedAt"],
            "leg": [observer_id],
            "legPublic": True,
        },
        "gatherings": [gathering],
        "creator": observer_id,
        "editor": observer_id,
    }
