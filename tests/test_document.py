import os
import sys
import unittest
from pathlib import Path

os.environ.setdefault("FLASK_SECRET_KEY", "test")
os.environ.setdefault("FINBIF_API_TOKEN", "test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))

from finbif.document import build_document, parse_submission


def _body(observations, **session_fields):
    session = {
        "startedAt": "2026-06-01T10:00",
        "endedAt": "2026-06-01T11:00",
        "lat": 60.17,
        "lon": 24.94,
    }
    session.update(session_fields)
    return {"session": session, "observations": observations}


def _observation():
    return {"seq": 1, "taxon": "Talitiainen", "at": "2026-06-01T10:05", "lat": 60.171, "lon": 24.941}


class DocumentPointsTest(unittest.TestCase):
    def test_unit_uses_the_pin_and_gathering_keeps_the_start_point(self):
        session, observations, header = parse_submission(
            _body(
                [
                    {
                        "seq": 1,
                        "taxon": "Talitiainen",
                        "at": "2026-06-01T10:05",
                        "lat": 60.171,
                        "lon": 24.941,
                    }
                ]
            )
        )
        document = build_document(session, observations, "MA.1", header)
        gathering = document["gatherings"][0]
        self.assertEqual(gathering["geometry"]["coordinates"], [24.94, 60.17])
        unit = gathering["units"][0]["unitGathering"]["geometry"]
        self.assertEqual(unit["type"], "Point")
        self.assertEqual(unit["coordinates"], [24.941, 60.171])

    def test_observation_without_a_point_uses_the_session_point(self):
        session, observations, header = parse_submission(
            _body([{"seq": 1, "taxon": "Talitiainen", "at": "2026-06-01T10:05"}])
        )
        document = build_document(session, observations, "MA.1", header)
        unit = document["gatherings"][0]["units"][0]["unitGathering"]["geometry"]
        self.assertEqual(unit["coordinates"], [24.94, 60.17])

    def test_a_pin_needs_both_coordinates(self):
        with self.assertRaises(ValueError):
            parse_submission(
                _body(
                    [
                        {
                            "seq": 1,
                            "taxon": "Talitiainen",
                            "at": "2026-06-01T10:05",
                            "lat": 60.171,
                        }
                    ]
                )
            )

    def test_route_becomes_a_linestring_in_lon_lat_order(self):
        session, observations, header = parse_submission(
            _body(
                [_observation()],
                points=[
                    {"lat": 60.17, "lon": 24.94},
                    {"lat": 60.171, "lon": 24.941},
                    {"lat": 60.17, "lon": 24.94},
                ],
            )
        )
        document = build_document(session, observations, "MA.1", header)
        geometry = document["gatherings"][0]["geometry"]
        self.assertEqual(geometry["type"], "LineString")
        self.assertEqual(
            geometry["coordinates"],
            [[24.94, 60.17], [24.941, 60.171], [24.94, 60.17]],
        )

    def test_one_route_point_is_a_point(self):
        session, observations, header = parse_submission(
            _body([_observation()], points=[{"lat": 60.18, "lon": 24.95}])
        )
        document = build_document(session, observations, "MA.1", header)
        geometry = document["gatherings"][0]["geometry"]
        self.assertEqual(geometry, {"type": "Point", "coordinates": [24.95, 60.18]})

    def test_empty_route_uses_the_start_point(self):
        session, observations, header = parse_submission(_body([_observation()], points=[]))
        document = build_document(session, observations, "MA.1", header)
        geometry = document["gatherings"][0]["geometry"]
        self.assertEqual(geometry, {"type": "Point", "coordinates": [24.94, 60.17]})

    def test_consecutive_duplicate_route_points_collapse_to_a_point(self):
        session, observations, header = parse_submission(
            _body(
                [_observation()],
                points=[
                    {"lat": 60.18, "lon": 24.95},
                    {"lat": 60.18, "lon": 24.95},
                ],
            )
        )
        document = build_document(session, observations, "MA.1", header)
        geometry = document["gatherings"][0]["geometry"]
        self.assertEqual(geometry, {"type": "Point", "coordinates": [24.95, 60.18]})

    def test_a_route_point_needs_both_coordinates(self):
        with self.assertRaises(ValueError):
            parse_submission(_body([_observation()], points=[{"lat": 60.18}]))

    def test_route_points_must_be_a_list(self):
        with self.assertRaises(ValueError):
            parse_submission(_body([_observation()], points={"lat": 60.18, "lon": 24.95}))

    def test_too_many_route_points_are_rejected(self):
        points = [{"lat": 60.18, "lon": 24.95} for _ in range(2001)]
        with self.assertRaises(ValueError):
            parse_submission(_body([_observation()], points=points))

    def test_chosen_taxon_id_is_sent_as_unit_fact(self):
        observation = _observation()
        observation["taxonId"] = " MX.36308 "
        session, observations, header = parse_submission(_body([observation]))
        document = build_document(session, observations, "MA.1", header)
        unit = document["gatherings"][0]["units"][0]
        self.assertEqual(observations[0]["taxonId"], "MX.36308")
        self.assertEqual(unit["identifications"], [{"taxon": "Talitiainen"}])
        self.assertEqual(unit["unitFact"], {"autocompleteSelectedTaxonID": "MX.36308"})

    def test_free_text_taxon_has_no_unit_fact(self):
        session, observations, header = parse_submission(_body([_observation()]))
        document = build_document(session, observations, "MA.1", header)
        unit = document["gatherings"][0]["units"][0]
        self.assertNotIn("taxonId", observations[0])
        self.assertNotIn("unitFact", unit)

    def test_blank_taxon_id_is_ignored(self):
        observation = _observation()
        observation["taxonId"] = "  "
        _session, observations, _header = parse_submission(_body([observation]))
        self.assertNotIn("taxonId", observations[0])

    def test_invalid_taxon_id_is_rejected(self):
        observation = _observation()
        observation["taxonId"] = "talitiainen"
        with self.assertRaises(ValueError):
            parse_submission(_body([observation]))

    def test_missing_keywords_stay_new(self):
        for document_header in (None, {}, {"locality": "Park"}):
            body = _body([_observation()])
            if document_header is not None:
                body["document"] = document_header
            _session, _observations, header = parse_submission(body)
            document = build_document(_session, _observations, "MA.1", header)
            self.assertEqual(document["keywords"], ["new"])
            self.assertNotIn("locality", document)

    def test_provided_keywords_are_placed_on_the_document(self):
        body = _body([_observation()])
        body["document"] = {"keywords": [" meadow ", "new"], "locality": "Park"}
        _session, _observations, header = parse_submission(body)
        document = build_document(_session, _observations, "MA.1", header)
        self.assertEqual(document["keywords"], ["meadow", "new"])
        self.assertNotIn("locality", document)

    def test_unknown_observation_fields_are_ignored(self):
        observation = _observation()
        observation["count"] = 4
        observation["id"] = "phone-1"
        _session, observations, _header = parse_submission(_body([observation]))
        self.assertEqual(set(observations[0]), {"seq", "taxon", "at", "lat", "lon"})

    def test_document_header_must_be_an_object(self):
        body = _body([_observation()])
        body["document"] = ["new"]
        with self.assertRaises(ValueError):
            parse_submission(body)


if __name__ == "__main__":
    unittest.main()
