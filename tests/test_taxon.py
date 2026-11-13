import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("FLASK_SECRET_KEY", "test")
os.environ.setdefault("FINBIF_API_TOKEN", "test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))

from finbif.taxon import (
    allowed_informal_taxon_groups,
    autocomplete_taxa,
    taxon_suggestion,
)


class AutocompleteTaxaGroupsTest(unittest.TestCase):
    @patch("finbif.taxon.get", return_value=(200, []))
    def test_omits_groups_when_missing(self, get):
        autocomplete_taxa("talitiainen")
        query = get.call_args.kwargs["query"]
        self.assertNotIn("informalTaxonGroups", query)

    @patch("finbif.taxon.get", return_value=(200, []))
    def test_omits_groups_when_empty(self, get):
        autocomplete_taxa("talitiainen", informal_taxon_groups=[])
        query = get.call_args.kwargs["query"]
        self.assertNotIn("informalTaxonGroups", query)

    @patch("finbif.taxon.get", return_value=(200, []))
    def test_joins_groups(self, get):
        autocomplete_taxa("talitiainen", informal_taxon_groups=["MVL.1", " MVL.343 ", ""])
        query = get.call_args.kwargs["query"]
        self.assertEqual("MVL.1,MVL.343", query["informalTaxonGroups"])

    @patch("finbif.taxon.get", return_value=(200, []))
    def test_ignores_a_string_of_groups(self, get):
        autocomplete_taxa("talitiainen", informal_taxon_groups="MVL.1")
        query = get.call_args.kwargs["query"]
        self.assertNotIn("informalTaxonGroups", query)


class TaxonSuggestionTest(unittest.TestCase):
    def test_pairs_finnish_and_scientific_names(self):
        suggestion = taxon_suggestion(
            {
                "id": "MX.36308",
                "vernacularName": "kottarainen",
                "scientificName": "Sturnus vulgaris",
            }
        )
        self.assertEqual(
            {"id": "MX.36308", "name": "kottarainen (Sturnus vulgaris)"},
            suggestion,
        )

    def test_uses_the_finnish_value_from_a_localized_object(self):
        suggestion = taxon_suggestion(
            {
                "id": "MX.1",
                "vernacularName": {"fi": "talitiainen", "en": "Great tit"},
                "scientificName": "Parus major",
            }
        )
        self.assertEqual("talitiainen (Parus major)", suggestion["name"])

    def test_uses_the_scientific_name_when_finnish_is_missing(self):
        suggestion = taxon_suggestion({"id": "MX.1", "scientificName": "Sturnus vulgaris"})
        self.assertEqual("Sturnus vulgaris", suggestion["name"])

    def test_skips_a_row_without_an_mx_id(self):
        self.assertIsNone(taxon_suggestion({"id": "MX.not", "scientificName": "A"}))
        self.assertIsNone(taxon_suggestion({"scientificName": "A"}))


class AllowedInformalTaxonGroupsTest(unittest.TestCase):
    def test_keeps_known_groups_in_order(self):
        self.assertEqual(
            ["MVL.1", "MVL.343"],
            allowed_informal_taxon_groups("MVL.1, nope, MVL.343, MVL.1"),
        )

    def test_empty_when_nothing_known(self):
        self.assertEqual([], allowed_informal_taxon_groups(""))
        self.assertEqual([], allowed_informal_taxon_groups(None))
        self.assertEqual([], allowed_informal_taxon_groups("MX.1"))
