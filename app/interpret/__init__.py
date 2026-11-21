"""Turn Finnish observation notes into count, sex, moving status, and plumage.

The phone calls this once, on the first save. Nothing is stored here.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable, Optional

import config

MODEL = "gpt-6-luna"
REASONING_EFFORT = "low"
TIMEOUT_SECONDS = 20.0

_DIR = Path(__file__).resolve().parent
_PROMPT = (_DIR / "prompt.txt").read_text(encoding="utf-8")
_SCHEMA = json.loads((_DIR / "schema.json").read_text(encoding="utf-8"))

# Applied to the notes, in this order, before the model sees them.
_NOTE_REPLACEMENTS = (
    ("naaras puku", "naaraspuku"),
    ("koiras puku", "koiraspuku"),
    ("juhla puku", "juhlapuku"),
)

_MOVING_STATUS = ("p", "m", "kiert", "Ä", "Än", "än", "ä")
_PLUMAGE = ("ad", "jp", "juv", "kpuk", "npuk", "pull", "subad")


class InterpretError(Exception):
    """The model output cannot be used. The phone marks the row failed."""


class InterpretUnavailable(Exception):
    """Try again later. The phone leaves the row pending."""


def prepare_notes(notes: str) -> str:
    """Lowercase every character except Ä, then apply the phrase replacements."""
    text = "".join(ch if ch == "Ä" else ch.lower() for ch in notes)
    for old, new in _NOTE_REPLACEMENTS:
        text = text.replace(old, new)
    return text


def _count(value: Any) -> Optional[str]:
    """Positive integers joined as text, such as 1,3. Anything else is omitted."""
    if not isinstance(value, list) or not value:
        return None
    numbers: list[str] = []
    for item in value:
        if isinstance(item, bool) or not isinstance(item, int) or item < 1:
            return None
        numbers.append(str(item))
    return ",".join(numbers)


def _sex_count(value: Any) -> Optional[int]:
    """An integer or a digit string. Zero, negatives, and fractions are omitted."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, str):
        text = value.strip()
        if text.isdigit():
            number = int(text)
            return number if number > 0 else None
    return None


def _moving_status(value: Any) -> Optional[list[str]]:
    if not isinstance(value, list):
        return None
    kept: list[str] = []
    for item in value:
        if isinstance(item, str) and item in _MOVING_STATUS and item not in kept:
            kept.append(item)
    return kept or None


def _plumage(value: Any) -> Optional[str]:
    if isinstance(value, str) and value in _PLUMAGE:
        return value
    return None


def validate_interpretation(raw: Any) -> dict[str, Any]:
    """Drop unknown keys and bad fields. An empty object is still success."""
    if not isinstance(raw, dict):
        raise InterpretError("Unusable model output.")
    result: dict[str, Any] = {}
    count = _count(raw.get("countArray"))
    if count:
        result["count"] = count
    male = _sex_count(raw.get("maleIndividualCount"))
    if male is not None:
        result["maleIndividualCount"] = male
    female = _sex_count(raw.get("femaleIndividualCount"))
    if female is not None:
        result["femaleIndividualCount"] = female
    moving = _moving_status(raw.get("movingStatus"))
    if moving:
        result["movingStatus"] = moving
    plumage = _plumage(raw.get("birdPlumage"))
    if plumage:
        result["birdPlumage"] = plumage
    return result


def call_openai(user_text: str) -> dict[str, Any]:
    """One responses.create call. Timeouts, rate limits, and transport errors are unavailable."""
    if not config.OPENAI_API_KEY:
        raise InterpretUnavailable("Interpretation is unavailable.")
    try:
        from openai import APIConnectionError, APIStatusError, APITimeoutError, OpenAI, RateLimitError
    except ImportError as exc:
        raise InterpretUnavailable("Interpretation is unavailable.") from exc

    client = OpenAI(api_key=config.OPENAI_API_KEY, timeout=TIMEOUT_SECONDS, max_retries=0)
    try:
        response = client.responses.create(
            model=MODEL,
            reasoning={"effort": REASONING_EFFORT},
            input=[
                {"role": "system", "content": _PROMPT},
                {"role": "user", "content": user_text},
            ],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "bird_observation",
                    "strict": True,
                    "schema": _SCHEMA,
                }
            },
        )
    except (APITimeoutError, APIConnectionError, RateLimitError) as exc:
        raise InterpretUnavailable("Interpretation is unavailable.") from exc
    except APIStatusError as exc:
        if getattr(exc, "status_code", None) in (429, 503):
            raise InterpretUnavailable("Interpretation is unavailable.") from exc
        raise InterpretError("Unusable model output.") from exc

    if not response.output_text:
        raise InterpretError("Empty model output.")
    try:
        parsed = json.loads(response.output_text)
    except json.JSONDecodeError as exc:
        raise InterpretError("Unusable model output.") from exc
    if not isinstance(parsed, dict):
        raise InterpretError("Unusable model output.")
    return parsed


def interpret_notes(
    notes: str,
    complete: Optional[Callable[[str], Any]] = None,
) -> dict[str, Any]:
    """Prepared notes only. complete replaces the model in tests."""
    user_text = prepare_notes(notes)
    raw = call_openai(user_text) if complete is None else complete(user_text)
    if not isinstance(raw, dict):
        raise InterpretError("Unusable model output.")
    return validate_interpretation(raw)
