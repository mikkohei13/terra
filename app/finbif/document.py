"""Build a FinBIF Vihko document from one field session.

A session has one location. Each observation is a species name and a time.
Count, notes, wildness, taxon id, and a route can be added in _build_unit later.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

import config

_STAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")
_MAX_OBSERVATIONS = 300
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


def _build_unit(obs: dict[str, Any], latitude: float, longitude: float) -> dict[str, Any]:
    return {
        "identifications": [{"taxon": obs["taxon"]}],
        "unitGathering": {
            "geometry": _point(latitude, longitude),
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
        indexed.append(
            (
                index,
                {
                    "seq": seq,
                    "taxon": taxon,
                    "at": _stamp(raw.get("at"), "Observation time"),
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

    latitude = session["lat"]
    longitude = session["lon"]
    gathering = {
        "geometry": _point(latitude, longitude),
        "units": [_build_unit(obs, latitude, longitude) for obs in observations],
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
