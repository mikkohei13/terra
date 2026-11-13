# Terra

Terra is a mobile-first prototype web app to make nature observations and submit them to FinBIF API. User can start an observation session, record observations on the way, and submit them to FinBIF API once the session is complete.

Built with Python/Flask (backend and bussiness logic) with vanilla JavaScript and CSS (frontend and UI).

See terra-spec.md for specifications for the prototype.

## Deployment

The app runs on Google Cloud Run, and the Makefile contains the deployment script. Required env vars are `FINBIF_API_TOKEN` and `FLASK_SECRET_KEY`.

## Login

Havistin posts the FinBIF person token to `POST /login` as `personToken`. Terra checks it with FinBIF `GET /person` and stores the token, person id, and name in a signed cookie (`HttpOnly`, `SameSite=Lax`, `Secure` on Cloud Run). The access token stays in `FINBIF_API_TOKEN` on the server. A GET, or a token in the query string, is ignored so it cannot be written to request logs. `POST /logout` clears the cookie only and does not revoke the token, because Havistin uses the same one. Logged-out visitors are linked to Havistin (`HAVISTIN_URL`).

Local Compose binds port 85 to `127.0.0.1` and sets `DEV_LOGIN=1`. Opening `http://127.0.0.1:85/dev/login` signs in with `DEV_PERSON_TOKEN` from `.env.dev`, which is not deployed. The route stays closed for any other host.

## Technical Overview

One observation session is active at a time, stored in IndexedDB on the phone until it is submitted. Starting a session reads the location once. The session screen is a Leaflet map of that position; a blue dot follows the user until the map is touched. Tap the map to place or move a pin. Add obs opens a dialog for the species name, and Cancel removes the pin. An observation is a species name, a time, and the pin's coordinates. Logout leaves this local data in place.

End session sends the session and its observations to `POST /api/sessions/submit`. The server builds one Vihko document (collection `HR.1747`, form `JX.519`): one gathering at the session start point, and one unit per observation at that observation's pin. Observations saved before pins existed still use the session point. It POSTs `/documents/validate`, then `/documents` only if validation passes. The observer is the person id from the cookie. On success the phone deletes the local session.

The page sends `Referrer-Policy: no-referrer` so a person token cannot leak. Map tiles are OpenStreetMap's standard layer, and each tile image sends only the site origin as its Referer, which OSM requires. The pin icon and shadow are local files in `app/static/images/`.

## Removing devdots

Grey dots on the session map mark stored route points. They are only for development. Remove them before the app is public. The route itself stays.

1. Delete `app/static/js/devdots.js`.
2. In `app/static/js/app.js`, delete the devdots import and every call marked `devdots`.
3. Search the repo for `devdots` and delete anything left, including this section.

Where to look when extending:

- `app/static/js/app.js` — screens, the map and pin, the observation dialog, save, end, and discard
- `app/static/js/db.js` — IndexedDB. This module does not call the network
- `app/static/js/api.js` — the only browser module that calls Terra
- `app/main.py` — pages, login, and the submit route
- `app/finbif/client.py` — HTTP calls to api.laji.fi. The access token never reaches the browser
- `app/finbif/document.py` — session to document. New observation fields belong in `_build_unit`
- `app/finbif/submit.py` — validate, then create
- `app/finbif/taxon.py` — taxon autocomplete helper, not used by the session flow yet
- `app/config.py` — collection, form, and environment settings

