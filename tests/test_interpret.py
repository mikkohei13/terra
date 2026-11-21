import os
import sys
import unittest
from pathlib import Path

os.environ.setdefault("FLASK_SECRET_KEY", "test")
os.environ.setdefault("FINBIF_API_TOKEN", "test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))

from interpret import InterpretError, interpret_notes, prepare_notes, validate_interpretation


class InterpretValidatorTest(unittest.TestCase):
    def test_fields_are_normalized_and_unknown_keys_are_ignored(self):
        result = validate_interpretation(
            {
                "countArray": [1, 3],
                "maleIndividualCount": 2,
                "femaleIndividualCount": "4",
                "movingStatus": ["ä", "p", "nope", "p", "Ä"],
                "birdPlumage": "kpuk",
                "taxon": "Sinisorsa",
                "notes": "ignored",
            }
        )
        self.assertEqual(
            result,
            {
                "count": "1,3",
                "maleIndividualCount": 2,
                "femaleIndividualCount": 4,
                "movingStatus": ["ä", "p", "Ä"],
                "birdPlumage": "kpuk",
            },
        )

    def test_kpuk_is_kept_the_same_way_as_npuk(self):
        for code in ("kpuk", "npuk"):
            result = validate_interpretation({"birdPlumage": code})
            self.assertEqual(result, {"birdPlumage": code})

    def test_a_bad_field_is_dropped_and_the_rest_stay(self):
        result = validate_interpretation(
            {
                "countArray": [1, 0],
                "maleIndividualCount": "pari",
                "femaleIndividualCount": "2",
                "movingStatus": "p",
                "birdPlumage": "adult",
            }
        )
        self.assertEqual(result, {"femaleIndividualCount": 2})

    def test_empty_and_unusable_count_and_sex_values_are_omitted(self):
        for count_array in (None, [], "1,3", [True], [1.5], ["1"]):
            result = validate_interpretation({"countArray": count_array, "birdPlumage": "ad"})
            self.assertNotIn("count", result)
        for value in (None, 0, -1, 1.5, True, "0", "5-10", "n. 10", "pari", ""):
            result = validate_interpretation({"maleIndividualCount": value, "femaleIndividualCount": value})
            self.assertEqual(result, {})

    def test_an_empty_object_is_success_and_a_non_object_is_not(self):
        self.assertEqual(validate_interpretation({}), {})
        self.assertEqual(validate_interpretation({"countArray": None, "movingStatus": None}), {})
        with self.assertRaises(InterpretError):
            validate_interpretation(["ad"])
        with self.assertRaises(InterpretError):
            interpret_notes("Talitiainen", "laulaa", lambda _text: ["ad"])

    def test_note_replacements_run_in_order_before_the_model(self):
        seen = []

        def complete(user_text):
            seen.append(user_text)
            return {"birdPlumage": "npuk", "countArray": [1]}

        notes = "yksi naaras puku ja koiras puku sekä juhla puku"
        result = interpret_notes("Sinisorsa", notes, complete)
        self.assertEqual(
            prepare_notes(notes),
            "yksi naaraspuku ja koiraspuku sekä juhlapuku",
        )
        self.assertEqual(seen, ["Sinisorsa yksi naaraspuku ja koiraspuku sekä juhlapuku"])
        self.assertEqual(result, {"count": "1", "birdPlumage": "npuk"})


if __name__ == "__main__":
    unittest.main()
