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
        for document_header in (None, {}):
            body = _body([_observation()])
            if document_header is not None:
                body["document"] = document_header
            _session, _observations, header = parse_submission(body)
            document = build_document(_session, _observations, "MA.1", header)
            self.assertEqual(document["keywords"], ["new"])
            self.assertNotIn("locality", document["gatherings"][0])

    def test_provided_keywords_are_placed_on_the_document(self):
        body = _body([_observation()])
        body["document"] = {"keywords": [" meadow ", "new"], "locality": " Park "}
        _session, _observations, header = parse_submission(body)
        document = build_document(_session, _observations, "MA.1", header)
        self.assertEqual(document["keywords"], ["meadow", "new"])
        self.assertEqual(document["gatherings"][0]["locality"], "Park")
        self.assertNotIn("locality", document)

    def test_blank_locality_is_left_out(self):
        body = _body([_observation()])
        body["document"] = {"locality": "  "}
        _session, _observations, header = parse_submission(body)
        document = build_document(_session, _observations, "MA.1", header)
        self.assertNotIn("locality", header)
        self.assertNotIn("locality", document["gatherings"][0])

    def test_locality_that_is_too_long_or_not_text_is_rejected(self):
        body = _body([_observation()])
        body["document"] = {"locality": "x" * 65}
        with self.assertRaises(ValueError):
            parse_submission(body)
        body["document"] = {"locality": 1}
        with self.assertRaises(ValueError):
            parse_submission(body)

    def test_count_and_notes_are_sent_on_the_unit(self):
        observation = _observation()
        observation["count"] = " 4 "
        observation["notes"] = " singing "
        session, observations, header = parse_submission(_body([observation]))
        document = build_document(session, observations, "MA.1", header)
        unit = document["gatherings"][0]["units"][0]
        self.assertEqual(observations[0]["count"], "4")
        self.assertEqual(observations[0]["notes"], "singing")
        self.assertEqual(unit["count"], "4")
        self.assertEqual(unit["notes"], "singing")
        self.assertEqual(unit["identifications"], [{"taxon": "Talitiainen"}])

    def test_accuracy_is_sent_as_the_unit_geometry_radius(self):
        observation = _observation()
        observation["accuracy"] = 100
        session, observations, header = parse_submission(_body([observation]))
        document = build_document(session, observations, "MA.1", header)
        gathering = document["gatherings"][0]
        unit = gathering["units"][0]["unitGathering"]["geometry"]
        self.assertEqual(observations[0]["accuracy"], 100)
        self.assertEqual(
            unit,
            {"type": "Point", "coordinates": [24.941, 60.171], "radius": 100},
        )
        self.assertNotIn("radius", gathering["geometry"])

    def test_missing_accuracy_leaves_the_radius_out(self):
        observation = _observation()
        observation["accuracy"] = None
        session, observations, header = parse_submission(_body([observation]))
        document = build_document(session, observations, "MA.1", header)
        unit = document["gatherings"][0]["units"][0]["unitGathering"]["geometry"]
        self.assertNotIn("accuracy", observations[0])
        self.assertEqual(unit, {"type": "Point", "coordinates": [24.941, 60.171]})

    def test_accuracy_must_be_a_whole_number_of_meters_within_bounds(self):
        for value in (0, -1, 5001, 1.5, True, "100"):
            observation = _observation()
            observation["accuracy"] = value
            with self.assertRaises(ValueError):
                parse_submission(_body([observation]))
        observation = _observation()
        observation["accuracy"] = 5000
        _session, observations, _header = parse_submission(_body([observation]))
        self.assertEqual(observations[0]["accuracy"], 5000)

    def test_blank_count_and_notes_are_left_out(self):
        observation = _observation()
        observation["count"] = "  "
        observation["notes"] = ""
        session, observations, header = parse_submission(_body([observation]))
        document = build_document(session, observations, "MA.1", header)
        unit = document["gatherings"][0]["units"][0]
        self.assertNotIn("count", observations[0])
        self.assertNotIn("notes", observations[0])
        self.assertNotIn("count", unit)
        self.assertNotIn("notes", unit)

    def test_count_and_notes_must_be_text(self):
        observation = _observation()
        observation["count"] = 4
        with self.assertRaises(ValueError):
            parse_submission(_body([observation]))
        observation = _observation()
        observation["notes"] = ["singing"]
        with self.assertRaises(ValueError):
            parse_submission(_body([observation]))

    def test_count_and_notes_that_are_too_long_are_rejected(self):
        observation = _observation()
        observation["count"] = "x" * 301
        with self.assertRaises(ValueError):
            parse_submission(_body([observation]))
        observation = _observation()
        observation["notes"] = "x" * 2001
        with self.assertRaises(ValueError):
            parse_submission(_body([observation]))

    def test_unknown_observation_fields_are_ignored(self):
        observation = _observation()
        observation["weather"] = "sun"
        observation["id"] = "phone-1"
        _session, observations, _header = parse_submission(_body([observation]))
        self.assertEqual(set(observations[0]), {"seq", "taxon", "at", "lat", "lon"})

    def test_interpreted_fields_are_sent_on_the_unit(self):
        observation = _observation()
        observation["count"] = "1,3"
        observation["maleIndividualCount"] = 1
        observation["femaleIndividualCount"] = 2
        observation["movingStatus"] = ["p", "m", "p", "Ä"]
        observation["birdPlumage"] = "kpuk"
        observation["notes"] = "naaras puku"
        observation["interpretationState"] = "done"
        session, observations, header = parse_submission(_body([observation]))
        document = build_document(session, observations, "MA.1", header)
        unit = document["gatherings"][0]["units"][0]
        self.assertEqual(observations[0]["count"], "1,3")
        self.assertEqual(observations[0]["maleIndividualCount"], 1)
        self.assertEqual(observations[0]["femaleIndividualCount"], 2)
        self.assertEqual(observations[0]["movingStatus"], ["p", "m", "Ä"])
        self.assertEqual(observations[0]["birdPlumage"], "kpuk")
        self.assertNotIn("interpretationState", observations[0])
        self.assertEqual(unit["count"], "1,3")
        self.assertEqual(unit["maleIndividualCount"], 1)
        self.assertEqual(unit["femaleIndividualCount"], 2)
        self.assertEqual(unit["movingStatus"], ["p", "m", "Ä"])
        self.assertEqual(unit["birdPlumage"], "MY.birdPlumageKpuk")
        self.assertEqual(unit["notes"], "naaras puku")
        self.assertNotIn("interpretationState", unit)

    def test_each_plumage_code_maps_onto_the_unit(self):
        codes = {
            "ad": "MY.birdPlumageAd",
            "jp": "MY.birdPlumageJp",
            "juv": "MY.birdPlumageJuv",
            "kpuk": "MY.birdPlumageKpuk",
            "npuk": "MY.birdPlumageNpuk",
            "pull": "MY.birdPlumagePull",
            "subad": "MY.birdPlumageSubad",
        }
        for short, full in codes.items():
            observation = _observation()
            observation["birdPlumage"] = short
            session, observations, header = parse_submission(_body([observation]))
            document = build_document(session, observations, "MA.1", header)
            unit = document["gatherings"][0]["units"][0]
            self.assertEqual(observations[0]["birdPlumage"], short)
            self.assertEqual(unit["birdPlumage"], full)

    def test_blank_interpreted_fields_are_left_out(self):
        observation = _observation()
        observation["maleIndividualCount"] = None
        observation["femaleIndividualCount"] = None
        observation["movingStatus"] = []
        observation["birdPlumage"] = "  "
        observation["interpretationState"] = "pending"
        session, observations, header = parse_submission(_body([observation]))
        document = build_document(session, observations, "MA.1", header)
        unit = document["gatherings"][0]["units"][0]
        for key in (
            "maleIndividualCount",
            "femaleIndividualCount",
            "movingStatus",
            "birdPlumage",
            "interpretationState",
        ):
            self.assertNotIn(key, observations[0])
            self.assertNotIn(key, unit)

    def test_bad_interpreted_fields_are_rejected(self):
        for key, value in (
            ("maleIndividualCount", "2"),
            ("maleIndividualCount", 0),
            ("maleIndividualCount", True),
            ("femaleIndividualCount", 1.5),
            ("movingStatus", "p"),
            ("movingStatus", ["p", "flying"]),
            ("birdPlumage", "adult"),
            ("birdPlumage", ["npuk"]),
        ):
            observation = _observation()
            observation[key] = value
            with self.assertRaises(ValueError):
                parse_submission(_body([observation]))

    def test_document_header_must_be_an_object(self):
        body = _body([_observation()])
        body["document"] = ["new"]
        with self.assertRaises(ValueError):
            parse_submission(body)


if __name__ == "__main__":
    unittest.main()
