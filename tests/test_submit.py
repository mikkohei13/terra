import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import requests

os.environ.setdefault("FLASK_SECRET_KEY", "test")
os.environ.setdefault("FINBIF_API_TOKEN", "test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))

import main
from finbif.client import SUBMIT_TIMEOUT, FinbifError, get
from finbif.submit import submit_session


def _body():
    return {
        "session": {
            "startedAt": "2026-06-01T10:00",
            "endedAt": "2026-06-01T11:00",
            "lat": 60.17,
            "lon": 24.94,
        },
        "observations": [
            {
                "seq": 1,
                "taxon": "Talitiainen",
                "at": "2026-06-01T10:05",
                "lat": 60.171,
                "lon": 24.941,
            }
        ],
    }


class SubmitTimeoutTest(unittest.TestCase):
    def test_validate_timeout_does_not_create(self):
        with patch("finbif.submit.post_json", side_effect=FinbifError(
            "FinBIF did not respond in time.",
            status_code=504,
            error_code="UPSTREAM_UNAVAILABLE",
        )) as post:
            with self.assertRaises(FinbifError) as caught:
                submit_session(_body(), person_token="t", observer_id="MA.1")
        self.assertFalse(caught.exception.maybe_saved)
        self.assertEqual(post.call_count, 1)
        self.assertEqual(post.call_args.kwargs["timeout"], SUBMIT_TIMEOUT)

    def test_create_timeout_may_already_be_saved(self):
        with patch("finbif.submit.post_json", side_effect=[
            (204, None),
            FinbifError(
                "FinBIF did not respond in time.",
                status_code=504,
                error_code="UPSTREAM_UNAVAILABLE",
            ),
        ]) as post:
            with self.assertRaises(FinbifError) as caught:
                submit_session(_body(), person_token="t", observer_id="MA.1")
        self.assertTrue(caught.exception.maybe_saved)
        self.assertEqual(post.call_args.kwargs["timeout"], SUBMIT_TIMEOUT)
        self.assertEqual(post.call_args.args[0], "/documents")

    def test_create_rejection_is_safe_to_retry(self):
        with patch("finbif.submit.post_json", side_effect=[
            (204, None),
            (400, {"message": "No.", "errorCode": "BAD"}),
        ]):
            with self.assertRaises(FinbifError) as caught:
                submit_session(_body(), person_token="t", observer_id="MA.1")
        self.assertFalse(caught.exception.maybe_saved)
        self.assertEqual(caught.exception.message, "No.")

    def test_route_tells_the_phone_the_document_may_exist(self):
        main.app.config["TESTING"] = True
        client = main.app.test_client()
        with client.session_transaction() as sess:
            sess["person_token"] = "t"
            sess["person_id"] = "MA.1"
        with patch.object(main, "submit_session", side_effect=FinbifError(
            "FinBIF did not respond in time.",
            status_code=504,
            error_code="UPSTREAM_UNAVAILABLE",
            maybe_saved=True,
        )):
            response = client.post("/api/sessions/submit", json=_body())
        self.assertEqual(504, response.status_code)
        self.assertEqual(True, response.get_json()["maybeSaved"])

    def test_get_timeout_is_a_finbif_error(self):
        with patch("finbif.client.requests.get", side_effect=requests.Timeout()) as request:
            with self.assertRaises(FinbifError) as caught:
                get("/person", person_token="t")
        self.assertEqual("UPSTREAM_UNAVAILABLE", caught.exception.error_code)
        self.assertFalse(caught.exception.maybe_saved)
        self.assertEqual(10, request.call_args.kwargs["timeout"])
