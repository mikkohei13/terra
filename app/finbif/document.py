"""Build FinBIF Vihko store-documents from observation data.

Extend Observation and _build_unit when richer observation fields are needed.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

import config


@dataclass
class Observation:
    taxon_id: str
    taxon_name: str
    date: str
    latitude: float
    longitude: float
    count: int = 1
    notes: str = ""
    # Extension hooks for later fields (confidence, facts, images, etc.)
    extras: dict[str, Any] = field(default_factory=dict)


def _gathering_geometry(observations: list[Observation]) -> dict[str, Any]:
    coords = [(obs.longitude, obs.latitude) for obs in observations]
    if not coords:
        raise ValueError("Ei koordinaatteja geometriaa varten.")

    first = coords[0]
    if all(c == first for c in coords):
        return {"type": "Point", "coordinates": [first[0], first[1]]}

    lngs = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    min_lng, max_lng = min(lngs), max(lngs)
    min_lat, max_lat = min(lats), max(lats)
    if min_lng == max_lng and min_lat == max_lat:
        return {"type": "Point", "coordinates": [min_lng, min_lat]}

    ring = [
        [min_lng, min_lat],
        [max_lng, min_lat],
        [max_lng, max_lat],
        [min_lng, max_lat],
        [min_lng, min_lat],
    ]
    return {"type": "Polygon", "coordinates": [ring]}


def _taxon_qname(taxon_id: str) -> str:
    tid = taxon_id.strip()
    if tid.startswith("http://tun.fi/"):
        return tid.replace("http://tun.fi/", "")
    return tid


def _build_unit(obs: Observation) -> dict[str, Any]:
    """Map one Observation to a FinBIF store-unit. Extend here for new fields."""
    count = max(1, int(obs.count or 1))
    unit: dict[str, Any] = {
        "count": str(count),
        "identifications": [{"taxon": obs.taxon_name}],
        "unitFact": {
            "autocompleteSelectedTaxonID": _taxon_qname(obs.taxon_id),
        },
        "unitGathering": {
            "geometry": {
                "type": "Point",
                "coordinates": [obs.longitude, obs.latitude],
            },
            "dateBegin": obs.date,
        },
        "taxonConfidence": "MY.taxonConfidenceSure",
        "recordBasis": "MY.recordBasisHumanObservation",
    }
    notes = (obs.notes or "").strip()
    if notes:
        unit["notes"] = notes
    return unit


def build_document(
    observations: list[Observation],
    observer_id: str,
    *,
    collection_id: Optional[str] = None,
    form_id: Optional[str] = None,
) -> dict[str, Any]:
    """
    Build one Vihko store-document: one gathering, one unit per observation.
    """
    if not observations:
        raise ValueError("Ei havaintoja dokumenttiin.")
    observer_id = (observer_id or "").strip()
    if not observer_id:
        raise ValueError("Havainnoijan tunniste puuttuu.")

    dates = [obs.date for obs in observations if obs.date]
    date_begin = dates[0] if dates else ""

    gathering = {
        "geometry": _gathering_geometry(observations),
        "units": [_build_unit(obs) for obs in observations],
    }

    return {
        "collectionID": collection_id or config.VIHKO_COLLECTION_ID,
        "formID": form_id or config.VIHKO_FORM_ID,
        "keywords": ["new"],
        "secureLevel": "MX.secureLevelNone",
        "gatheringEvent": {
            "dateBegin": date_begin,
            "leg": [observer_id],
            "legPublic": True,
        },
        "gatherings": [gathering],
        "creator": observer_id,
        "editor": observer_id,
    }
