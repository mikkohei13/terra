import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("FLASK_SECRET_KEY", "test")
os.environ.setdefault("FINBIF_API_TOKEN", "test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))

import main


class LoginTest(unittest.TestCase):
    def setUp(self):
        main.app.config["TESTING"] = True
        self.client = main.app.test_client()

    def test_get_is_rejected(self):
        with patch.object(main, "fetch_person") as fetch:
            response = self.client.get("/login?personToken=from-query")
        self.assertEqual(405, response.status_code)
        fetch.assert_not_called()

    def test_query_string_on_post_does_not_log_in(self):
        with patch.object(main, "fetch_person") as fetch:
            response = self.client.post("/login?personToken=from-query")
        self.assertEqual(303, response.status_code)
        fetch.assert_not_called()
        with self.client.session_transaction() as sess:
            self.assertNotIn("person_token", sess)

    def test_post_form_starts_a_session(self):
        with patch.object(
            main, "fetch_person", return_value={"id": "MA.1", "fullName": "Ada"}
        ) as fetch:
            response = self.client.post("/login", data={"personToken": "person-token"})
        self.assertEqual(303, response.status_code)
        fetch.assert_called_once_with("person-token")
        with self.client.session_transaction() as sess:
            self.assertEqual("person-token", sess["person_token"])
            self.assertEqual("MA.1", sess["person_id"])
