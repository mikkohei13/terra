"""Taxon autocomplete and name resolution against FinBIF."""

from __future__ import annotations

import re
from typing import Any, Optional

from finbif.client import FinbifError, get

# Same ids as INFORMAL_TAXON_GROUPS in static/js/settings.js.
INFORMAL_TAXON_GROUP_IDS = ("MVL.1", "MVL.232", "MVL.343", "MVL.233")

_TAXON_ID = re.compile(r"^MX\.\d+$")


def autocomplete_taxa(
    query: str,
    *,
    limit: int = 15,
    person_token: Optional[str] = None,
    informal_taxon_groups: Optional[list[str]] = None,
) -> list[dict[str, Any]]:
    query = (query or "").strip()
    if not query:
        return []

    limit = min(max(int(limit), 1), 30)
    params: dict[str, Any] = {
        "query": query,
        "limit": limit,
        "finnish": True,
        "languages": "fi",
        "matchType": "exact,partial,likely",
        "includeHidden": False,
        "checklist": "MR.1",
    }
    groups = _informal_taxon_groups_param(informal_taxon_groups)
    if groups:
        params["informalTaxonGroups"] = groups
    status, body = get(
        "/autocomplete/taxa",
        query=params,
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


def normalize_taxon_id(value: Any) -> Optional[str]:
    """Return a short MX id, or None when the value is empty or not an MX id."""
    text = str(value or "").strip()
    if not _TAXON_ID.fullmatch(text):
        return None
    return text


def allowed_informal_taxon_groups(value: Optional[str]) -> list[str]:
    """Keep known group ids from a comma-separated query value, in that order."""
    if not value:
        return []
    allowed = set(INFORMAL_TAXON_GROUP_IDS)
    seen: list[str] = []
    for part in str(value).split(","):
        group_id = part.strip()
        if group_id in allowed and group_id not in seen:
            seen.append(group_id)
    return seen


def taxon_suggestion(row: dict[str, Any]) -> Optional[dict[str, str]]:
    """One autocomplete row as the id and the name shown in the field."""
    taxon_id = normalize_taxon_id(row.get("id"))
    if not taxon_id:
        return None
    vernacular = _localized_name(row.get("vernacularName"))
    scientific = _localized_name(row.get("scientificName"))
    if vernacular and scientific and vernacular.casefold() != scientific.casefold():
        name = f"{vernacular} ({scientific})"
    else:
        name = vernacular or scientific
    if not name:
        return None
    return {"id": taxon_id, "name": name}


def _localized_name(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        for key in ("fi", "en", "sv"):
            text = value.get(key)
            if isinstance(text, str) and text.strip():
                return text.strip()
    return ""


def _informal_taxon_groups_param(groups: Optional[list[str]]) -> str:
    if not isinstance(groups, list):
        return ""
    parts = []
    for item in groups:
        text = str(item).strip()
        if text:
            parts.append(text)
    return ",".join(parts)


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
