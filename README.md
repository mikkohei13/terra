# Terra

Mobile-first web app for recording nature observations on a phone and submitting them as one FinBIF Vihko document. Python/Flask owns the business rules. Vanilla JavaScript is the screen, geolocation, and local storage.

## Run

Local: Docker Compose on `127.0.0.1:85` (`make dev`). Production: Google Cloud Run (`make deploy`). Required env vars are `FINBIF_API_TOKEN` and `FLASK_SECRET_KEY`.

## Login

Havistin POSTs the FinBIF person token to `/login` as `personToken`. Terra checks it with `GET /person` and stores the token, person id, and name in a signed cookie (`HttpOnly`, `SameSite=Lax`, `Secure` on Cloud Run). The API access token stays in `FINBIF_API_TOKEN` on the server. A GET, or a token in the query string, is ignored so it cannot be written to request logs. `POST /logout` clears the cookie only. The token is shared with Havistin, so it is left in place. Logged-out visitors are linked to `HAVISTIN_URL`.

Local Compose sets `DEV_LOGIN=1`. Opening `http://127.0.0.1:85/dev/login` signs in with `DEV_PERSON_TOKEN` from `.env.dev`, which is not deployed. Any other host gets 404.

## Field session

One session is active at a time, in IndexedDB, until it is submitted or discarded. Logout leaves it on the phone.

Start reads the location once. The session screen is a Leaflet map. A blue dot follows the user until the map is dragged. A tap places or moves a pin. Add obs opens a dialog for the species name, with FinBIF autocomplete. Cancel removes the pin. An observation stores the name, an optional taxon id, the time, and the pin. Each listed observation has Edit, and tapping near saved observations opens the same form. Edit copies the stored record and overlays the fields the form shows, so anything the form does not touch stays. Delete is on that form and asks first. Change location moves the pin; Save writes the new point only after Use this point. Cancel keeps the previous point.

While the session screen is open, the browser thins GPS fixes (`route.js`: accuracy and minimum distance) and appends them to the route. That filter runs offline on each fix. The server checks the stored points when the draft is posted.

End session opens a document step. It has a locality name (at most 64 characters) and keywords, with `new` shown when none are stored yet. Back to map stores those fields on the session and returns to the map. Submit to Vihko writes `endedAt` from the phone clock, then POSTs the stored session, its observations, and the `document` object to `POST /api/sessions/submit`. On success the phone deletes the local session. Until then the draft stays.

Discard session asks first, saves that same payload as a JSON file on the phone, and deletes the local session. It does not post to FinBIF.

Settings for this browser (taxon groups for autocomplete, autocomplete cache, route spacing) live in `localStorage`.

## Server

`app/finbif/document.py` is the field contract. It parses the posted draft and builds one Vihko document (collection `HR.1747`, form `JX.519`):

- One gathering. Its geometry is the route: a LineString, or a Point when fewer than two positions remain. With no route points it is the session start.
- One unit per observation, at that observation's pin. An observation without a pin uses the session point. A chosen taxon id is sent as `unitFact.autocompleteSelectedTaxonID`.
- Keywords from the optional `document` object. When they are missing, the document uses `new`.
- Locality from that same object, written on the gathering. A blank locality is left out.

Unknown keys are ignored. A new observation field is read in `_parse_observation` and mapped in `_build_unit`. A document-level field, such as keywords or a locality name, is read in `_parse_header` and written in `build_document`.

`app/finbif/submit.py` POSTs `/documents/validate`, then `/documents` only if validation passes. The observer is the person id from the cookie. `app/finbif/client.py` is the HTTP client for api.laji.fi. It always sends the access token and the person token. Other remote services get their own module.

The page sends `Referrer-Policy: no-referrer`. Map tiles are OpenStreetMap's standard layer, and each tile image sends only the site origin as its Referer. The pin icon and shadow are local files in `app/static/images/`.

## Where to look

- `app/static/js/app.js` — screens, start, end, and discard
- `app/static/js/session-map.js` — map, pin, follow, and geolocation
- `app/static/js/observe.js` — observation dialog, list, save, and delete
- `app/static/js/route.js` — which GPS fixes are stored while offline
- `app/static/js/db.js` — IndexedDB. This module does not call the network
- `app/static/js/api.js` — the only browser module that calls Terra
- `app/static/js/settings.js` — browser settings. This module does not touch the DOM or the network
- `app/main.py` — pages, login, and JSON routes
- `app/finbif/document.py` — parse the draft and build the Vihko document
- `app/finbif/submit.py` — validate, then create
- `app/finbif/taxon.py` — taxon autocomplete
- `app/config.py` — collection, form, and environment

## Removing devdots

Grey dots on the session map mark stored route points. They are only for development. Remove them before the app is public. The route itself stays.

1. Delete `app/static/js/devdots.js`.
2. In `app/static/js/session-map.js`, delete the devdots import and every call marked `devdots`.
3. Search the repo for `devdots` and delete anything left, including this section.
