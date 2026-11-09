import os
import sys
import unittest
from pathlib import Path

os.environ.setdefault("FLASK_SECRET_KEY", "test")
os.environ.setdefault("FINBIF_API_TOKEN", "test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))

from finbif.document import build_document, parse_submission


def _body(observations):
    return {
        "session": {
            "startedAt": "2026-06-01T10:00",
            "endedAt": "2026-06-01T11:00",
            "lat": 60.17,
            "lon": 24.94,
        },
        "observations": observations,
    }


class DocumentPointsTest(unittest.TestCase):
    def test_unit_uses_the_pin_and_gathering_keeps_the_start_point(self):
        session, observations = parse_submission(
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
        document = build_document(session, observations, "MA.1")
        gathering = document["gatherings"][0]
        self.assertEqual(gathering["geometry"]["coordinates"], [24.94, 60.17])
        unit = gathering["units"][0]["unitGathering"]["geometry"]
        self.assertEqual(unit["type"], "Point")
        self.assertEqual(unit["coordinates"], [24.941, 60.171])

    def test_observation_without_a_point_uses_the_session_point(self):
        session, observations = parse_submission(
            _body([{"seq": 1, "taxon": "Talitiainen", "at": "2026-06-01T10:05"}])
        )
        document = build_document(session, observations, "MA.1")
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


if __name__ == "__main__":
    unittest.main()
