"""Taxon autocomplete and name resolution against FinBIF."""

from __future__ import annotations

from typing import Any, Optional

from finbif.client import FinbifError, get


def autocomplete_taxa(
    query: str,
    *,
    limit: int = 15,
    person_token: Optional[str] = None,
) -> list[dict[str, Any]]:
    query = (query or "").strip()
    if not query:
        return []

    limit = min(max(int(limit), 1), 30)
    status, body = get(
        "/autocomplete/taxa",
        query={
            "query": query,
            "limit": limit,
            "finnish": True,
            "languages": "fi",
            "matchType": "exact,partial,likely",
            "includeHidden": False,
            "checklist": "MR.1",
        },
        person_token=person_token,
    )
    if status != 200:
        message = "Taksonihaku epäonnistui."
        if isinstance(body, dict) and body.get("message"):
            message = str(body["message"])
        raise FinbifError(message, status_code=status, details=body)

    if isinstance(body, list):
        return body
    if isinstance(body, dict):
        results = body.get("results")
        if isinstance(results, list):
            return results
    return []


def _pick_taxon_id(results: list[dict[str, Any]], query: str) -> Optional[str]:
    target = query.strip().lower()
    candidates = []
    for row in results:
        tid = row.get("id")
        if not tid or not str(tid).startswith("MX."):
            continue
        candidates.append(row)
    if not candidates:
        return None
    for row in candidates:
        vernacular = (row.get("vernacularName") or "").strip().lower()
        scientific = (row.get("scientificName") or "").strip().lower()
        if vernacular == target or scientific == target:
            return str(row["id"])
    return str(candidates[0]["id"])


def resolve_taxon(
    name_or_id: str,
    *,
    person_token: Optional[str] = None,
) -> tuple[str, str]:
    """
    Resolve a taxon name or MX.* id to (taxon_id, display_name).
    Raises FinbifError if nothing usable is found.
    """
    value = (name_or_id or "").strip()
    if not value:
        raise FinbifError("Laji puuttuu.")

    if value.startswith("MX."):
        return value, value

    results = autocomplete_taxa(value, limit=12, person_token=person_token)
    taxon_id = _pick_taxon_id(results, value)
    if not taxon_id:
        raise FinbifError(f"Lajia ei löytynyt: {value}")

    display = value
    for row in results:
        if str(row.get("id")) == taxon_id:
            display = (
                (row.get("vernacularName") or "").strip()
                or (row.get("scientificName") or "").strip()
                or value
            )
            break
    return taxon_id, display
