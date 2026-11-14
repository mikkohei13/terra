import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("FLASK_SECRET_KEY", "test")
os.environ.setdefault("FINBIF_API_TOKEN", "test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))

import main


class AutocompleteRouteTest(unittest.TestCase):
    def setUp(self):
        main.app.config["TESTING"] = True
        self.client = main.app.test_client()

    def _login(self):
        with self.client.session_transaction() as sess:
            sess["person_token"] = "token"
            sess["person_id"] = "MA.1"

    def test_requires_login(self):
        response = self.client.get("/api/taxa/autocomplete?query=kottarainen")
        self.assertEqual(401, response.status_code)

    def test_returns_names_and_omits_groups_when_absent(self):
        self._login()
        rows = [
            {
                "id": "MX.36308",
                "matchingName": "kottarainen",
                "vernacularName": "kottarainen",
                "scientificName": "Sturnus vulgaris",
            },
            {"id": "not-an-id", "scientificName": "Nope"},
            "bad",
        ]
        with patch.object(main, "autocomplete_taxa", return_value=rows) as autocomplete:
            response = self.client.get("/api/taxa/autocomplete?query=kottaroinen")
        self.assertEqual(200, response.status_code)
        self.assertEqual(
            [
                {
                    "id": "MX.36308",
                    "name": "kottarainen (Sturnus vulgaris)",
                    "value": "kottarainen",
                }
            ],
            response.get_json()["results"],
        )
        autocomplete.assert_called_once_with(
            "kottaroinen",
            limit=10,
            informal_taxon_groups=[],
        )

    def test_passes_known_groups_only(self):
        self._login()
        with patch.object(main, "autocomplete_taxa", return_value=[]) as autocomplete:
            response = self.client.get(
                "/api/taxa/autocomplete?query=talitiainen&informalTaxonGroups=MVL.1,MX.1,MVL.343"
            )
        self.assertEqual(200, response.status_code)
        self.assertEqual([], response.get_json()["results"])
        autocomplete.assert_called_once_with(
            "talitiainen",
            limit=10,
            informal_taxon_groups=["MVL.1", "MVL.343"],
        )
