"""HTTP client for api.laji.fi."""

from __future__ import annotations

from typing import Any, Optional
from urllib.parse import urlencode

import requests

import config


class FinbifError(Exception):
    """FinBIF API returned an error payload or unexpected status."""

    def __init__(
        self,
        message: str,
        status_code: Optional[int] = None,
        error_code: Optional[str] = None,
        details: Any = None,
    ):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.error_code = error_code
        self.details = details


def _headers(person_token: Optional[str] = None, accept_language: str = "fi") -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {config.FINBIF_API_TOKEN}",
        "API-Version": "1",
        "Accept": "application/json",
        "Accept-Language": accept_language,
    }
    if person_token:
        headers["Person-Token"] = person_token
    return headers


def _url(path: str, query: Optional[dict[str, Any]] = None) -> str:
    base = config.FINBIF_API_BASE
    if not path.startswith("/"):
        path = "/" + path
    url = f"{base}{path}"
    if query:
        parts = {}
        for key, value in query.items():
            if value is None:
                continue
            if isinstance(value, bool):
                parts[key] = "true" if value else "false"
            else:
                parts[key] = value
        url = f"{url}?{urlencode(parts, doseq=True)}"
    return url


def _parse_response(response: requests.Response) -> tuple[int, Any]:
    if response.status_code == 204 or not response.content:
        return response.status_code, None
    try:
        return response.status_code, response.json()
    except ValueError:
        return response.status_code, {"raw": response.text}


def get(
    path: str,
    *,
    query: Optional[dict[str, Any]] = None,
    person_token: Optional[str] = None,
    accept_language: str = "fi",
    timeout: int = 60,
) -> tuple[int, Any]:
    response = requests.get(
        _url(path, query),
        headers=_headers(person_token, accept_language),
        timeout=timeout,
    )
    return _parse_response(response)


def post_json(
    path: str,
    body: dict[str, Any],
    *,
    query: Optional[dict[str, Any]] = None,
    person_token: Optional[str] = None,
    accept_language: str = "fi",
    timeout: int = 120,
) -> tuple[int, Any]:
    headers = _headers(person_token, accept_language)
    headers["Content-Type"] = "application/json"
    response = requests.post(
        _url(path, query),
        headers=headers,
        json=body,
        timeout=timeout,
    )
    return _parse_response(response)


def fetch_person(person_token: str) -> dict[str, Any]:
    status, body = get("/person", person_token=person_token)
    if status != 200 or not isinstance(body, dict):
        message = "Henkilötietojen haku epäonnistui."
        error_code = None
        if isinstance(body, dict):
            message = str(body.get("message") or message)
            error_code = body.get("errorCode")
        raise FinbifError(message, status_code=status, error_code=error_code, details=body)
    if body.get("errorCode"):
        raise FinbifError(
            str(body.get("message") or "Kirjautuminen epäonnistui."),
            status_code=status,
            error_code=body.get("errorCode"),
            details=body,
        )
    return body


def fetch_recent_observations(person_token: str, page_size: int = 5) -> list[dict[str, Any]]:
    """Return the user's most recent warehouse units (self as observer)."""
    status, body = get(
        "/warehouse/query/unit/list",
        query={
            "selfAsObserver": True,
            "cache": False,
            "pageSize": page_size,
            "page": 1,
            "orderBy": "gathering.eventDate.begin DESC",
            "selected": ",".join(
                [
                    "unit.linkings.taxon.nameFinnish",
                    "unit.linkings.taxon.scientificName",
                    "unit.taxonVerbatim",
                    "gathering.eventDate.begin",
                    "gathering.displayDateTime",
                    "gathering.conversions.wgs84CenterPoint.lat",
                    "gathering.conversions.wgs84CenterPoint.lon",
                    "document.documentId",
                ]
            ),
        },
        person_token=person_token,
    )
    if status != 200 or not isinstance(body, dict):
        message = "Havaintojen haku epäonnistui."
        error_code = None
        if isinstance(body, dict):
            message = str(body.get("message") or message)
            error_code = body.get("errorCode")
        raise FinbifError(message, status_code=status, error_code=error_code, details=body)

    results = body.get("results") or []
    rows = []
    for item in results:
        unit = item.get("unit") or {}
        gathering = item.get("gathering") or {}
        document = item.get("document") or {}
        linkings = (unit.get("linkings") or {}).get("taxon") or {}
        conversions = gathering.get("conversions") or {}
        center = conversions.get("wgs84CenterPoint") or {}
        event_date = gathering.get("eventDate") or {}
        name = (
            linkings.get("nameFinnish")
            or linkings.get("scientificName")
            or unit.get("taxonVerbatim")
            or "—"
        )
        rows.append(
            {
                "name": name,
                "scientific_name": linkings.get("scientificName") or "",
                "date": event_date.get("begin") or gathering.get("displayDateTime") or "—",
                "lat": center.get("lat"),
                "lon": center.get("lon"),
                "document_id": document.get("documentId") or "",
            }
        )
    return rows
