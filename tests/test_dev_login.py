import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("FLASK_SECRET_KEY", "test")
os.environ.setdefault("FINBIF_API_TOKEN", "test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))

import main
from finbif.client import FinbifError


class DevLoginTest(unittest.TestCase):
    def setUp(self):
        main.app.config["TESTING"] = True
        self.client = main.app.test_client()

    def test_closed_without_the_flag(self):
        with (
            patch.object(main.config, "DEV_LOGIN", False),
            patch.object(main, "fetch_person") as fetch,
        ):
            response = self.client.get("/dev/login")
        self.assertEqual(404, response.status_code)
        fetch.assert_not_called()

    def test_closed_for_a_non_local_host(self):
        with (
            patch.object(main.config, "DEV_LOGIN", True),
            patch.object(main.config, "DEV_PERSON_TOKEN", "person-token"),
            patch.object(main, "fetch_person") as fetch,
        ):
            response = self.client.get("/dev/login", base_url="http://terra.biomi.org")
        self.assertEqual(404, response.status_code)
        fetch.assert_not_called()

    def test_starts_a_session_from_the_env_token(self):
        with (
            patch.object(main.config, "DEV_LOGIN", True),
            patch.object(main.config, "DEV_PERSON_TOKEN", "person-token"),
            patch.object(main, "fetch_person", return_value={"id": "MA.1", "fullName": "Ada"}) as fetch,
        ):
            response = self.client.get("/dev/login")
        self.assertEqual(303, response.status_code)
        self.assertTrue(response.headers["Location"].endswith("/"))
        fetch.assert_called_once_with("person-token")
        with self.client.session_transaction() as sess:
            self.assertEqual("person-token", sess["person_token"])
            self.assertEqual("MA.1", sess["person_id"])
            self.assertEqual("Ada", sess["person_name"])

    def test_missing_token_does_not_start_a_session(self):
        with (
            patch.object(main.config, "DEV_LOGIN", True),
            patch.object(main.config, "DEV_PERSON_TOKEN", ""),
            patch.object(main, "fetch_person") as fetch,
        ):
            response = self.client.get("/dev/login")
        self.assertEqual(303, response.status_code)
        fetch.assert_not_called()
        with self.client.session_transaction() as sess:
            self.assertNotIn("person_token", sess)

    def test_rejected_token_does_not_start_a_session(self):
        with (
            patch.object(main.config, "DEV_LOGIN", True),
            patch.object(main.config, "DEV_PERSON_TOKEN", "person-token"),
            patch.object(main, "fetch_person", side_effect=FinbifError("Login is not valid.")),
        ):
            response = self.client.get("/dev/login")
        self.assertEqual(303, response.status_code)
        with self.client.session_transaction() as sess:
            self.assertNotIn("person_token", sess)
