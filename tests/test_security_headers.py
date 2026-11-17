import os
import sys
import unittest
from pathlib import Path

os.environ.setdefault("FLASK_SECRET_KEY", "test")
os.environ.setdefault("FINBIF_API_TOKEN", "test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))

import main


class SecurityHeadersTest(unittest.TestCase):
    def setUp(self):
        main.app.config["TESTING"] = True
        self.client = main.app.test_client()

    def test_responses_send_security_headers(self):
        response = self.client.get("/")
        headers = response.headers
        policy = headers["Content-Security-Policy"]
        self.assertIn("default-src 'self'", policy)
        self.assertIn("script-src 'self'", policy)
        self.assertNotIn("unpkg.com", policy)
        self.assertIn("https://tile.openstreetmap.org", policy)
        self.assertIn("frame-ancestors 'none'", policy)
        self.assertIn("form-action 'self'", policy)
        self.assertEqual("nosniff", headers["X-Content-Type-Options"])
        self.assertEqual("DENY", headers["X-Frame-Options"])
        self.assertEqual("max-age=31536000", headers["Strict-Transport-Security"])
        self.assertEqual("no-referrer", headers["Referrer-Policy"])

    def test_logged_in_page_loads_leaflet_from_this_origin(self):
        with self.client.session_transaction() as sess:
            sess["person_token"] = "person-token"
            sess["person_id"] = "MA.1"
            sess["person_name"] = "Ada"
        response = self.client.get("/")
        body = response.get_data(as_text=True)
        self.assertNotIn("unpkg.com", body)
        self.assertIn("/static/vendor/leaflet/leaflet.js", body)
        self.assertIn("/static/vendor/leaflet/leaflet.css", body)
        for filename in (
            "vendor/leaflet/leaflet.js",
            "vendor/leaflet/leaflet.css",
            "vendor/leaflet/images/marker-icon.png",
        ):
            static = self.client.get(f"/static/{filename}")
            self.assertEqual(200, static.status_code, filename)
            static.close()
