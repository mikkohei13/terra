"""Validate and create one FinBIF document for a field session."""

from __future__ import annotations

from typing import Any

from finbif.client import FinbifError, post_json
from finbif.document import build_document, parse_submission


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


def submit_session(
    body: dict[str, Any],
    *,
    person_token: str,
    observer_id: str,
) -> dict[str, Any]:
    """
    POST /documents/validate, then POST /documents only if validation passes.
    Returns document_id on success.
    """
    session, observations = parse_submission(body)
    document = build_document(session, observations, observer_id)

    v_status, v_body = post_json(
        "/documents/validate",
        document,
        query={"lang": "en"},
        person_token=person_token,
        accept_language="en",
    )
    if v_status not in (204, 201):
        raise _error_from_body("Validation failed.", v_status, v_body)

    c_status, c_body = post_json(
        "/documents",
        document,
        query={"lang": "en"},
        person_token=person_token,
        accept_language="en",
    )
    if c_status != 201 or not isinstance(c_body, dict):
        raise _error_from_body("Saving the document failed.", c_status, c_body)

    return {"document_id": c_body.get("id")}
