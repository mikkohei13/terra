"""Validate and create FinBIF documents."""

from __future__ import annotations

from typing import Any

from finbif.client import FinbifError, post_json
from finbif.document import Observation, build_document


def _error_from_body(fallback: str, status: int, body: Any) -> FinbifError:
    message = fallback
    error_code = None
    details = None
    if isinstance(body, dict):
        if body.get("message"):
            message = str(body["message"])
        error_code = body.get("errorCode")
        details = body.get("details")
    return FinbifError(message, status_code=status, error_code=error_code, details=details)


def submit_observations(
    observations: list[Observation],
    *,
    person_token: str,
    observer_id: str,
) -> dict[str, Any]:
    """
    POST /documents/validate; only on success POST /documents.
    Returns a result dict with ok=True and document_id on success.
    """
    document = build_document(observations, observer_id)

    v_status, v_body = post_json(
        "/documents/validate",
        document,
        query={"lang": "fi"},
        person_token=person_token,
    )
    if v_status not in (204, 201):
        raise _error_from_body("Validointi epäonnistui.", v_status, v_body)

    c_status, c_body = post_json(
        "/documents",
        document,
        query={"lang": "fi"},
        person_token=person_token,
    )
    if c_status != 201 or not isinstance(c_body, dict):
        raise _error_from_body("Tallennus epäonnistui.", c_status, c_body)

    return {
        "ok": True,
        "document_id": c_body.get("id"),
        "document": c_body,
    }
