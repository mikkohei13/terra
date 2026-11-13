"""Build a FinBIF Vihko document from one field session.

The gathering is the route: a LineString, or a Point when only one position
remains. With no route points it is the session start. Each observation is a
species name, a time, and its own point. Older observations without a point
use the session point.

Count, notes, wildness, and taxon id can be added in _build_unit later.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

import config

_STAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")
_MAX_OBSERVATIONS = 300
_MAX_ROUTE_POINTS = 2000
_MAX_TAXON_LENGTH = 300


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
    return {
        "identifications": [{"taxon": obs["taxon"]}],
        "unitGathering": {
            "geometry": _point(obs["lat"], obs["lon"]),
            "dateBegin": obs["at"],
        },
        "taxonConfidence": "MY.taxonConfidenceSure",
        "recordBasis": "MY.recordBasisHumanObservation",
    }


def parse_submission(body: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
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
        latitude, longitude = _observation_point(raw, session["lat"], session["lon"])
        indexed.append(
            (
                index,
                {
                    "seq": seq,
                    "taxon": taxon,
                    "at": _stamp(raw.get("at"), "Observation time"),
                    "lat": latitude,
                    "lon": longitude,
                },
            )
        )

    indexed.sort(key=lambda item: (item[1]["seq"], item[0]))
    observations = [item[1] for item in indexed]
    return session, observations


def build_document(
    session: dict[str, Any],
    observations: list[dict[str, Any]],
    observer_id: str,
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
        "keywords": ["new"],
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
