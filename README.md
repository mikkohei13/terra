# Terra

Mobile-first web app for recording nature observations and submitting them as one FinBIF Vihko document.

Python/Flask owns business rules and validation. Vanilla JS owns the UI, geolocation, IndexedDB, and browser settings.

## Run

Local: `make dev` → `http://127.0.0.1:85` (Compose mounts `./app`, gunicorn reloads).

Production: `make deploy` (Cloud Run, port 8080, env from `.env`).

Required: `FINBIF_API_TOKEN`, `FLASK_SECRET_KEY`. See `example.env`. Local also uses `.env.dev`.

## Tests

```
docker compose run --rm --entrypoint python -v ./tests:/terra/tests web -m unittest discover -s /terra/tests
```

`tests/` is not in the image. See `AGENTS.md` for agent-oriented run notes.

## Login

Havistin `POST /login` with form field `personToken`. Terra checks it via FinBIF `/person` and stores token, person id, and name in a signed cookie (`HttpOnly`, `SameSite=Lax`, `Secure` on Cloud Run). Query-string tokens are ignored. `POST /logout` clears the cookie only. Logged-out visitors link to `HAVISTIN_URL`.

Local Compose sets `DEV_LOGIN=1`: `http://127.0.0.1:85/dev/login` uses `DEV_PERSON_TOKEN` from `.env.dev` (not deployed; non-local hosts get 404).

## Field session

One active session in IndexedDB. Logout leaves local data on the phone.

**Map.** Start takes a GPS fix. Tap places a pin; Add obs opens the observation dialog (taxon, count, notes, accuracy in meters). Accuracy can be suggested from observer→pin distance and is drawn on the map; it is not yet included in the Vihko payload. Route points are thinned on the phone (`route.js`: GPS accuracy cap and `minDistanceM` from settings) while the session screen is open.

**Taxon search.** The letter left of the name cycles A → B → C and is stored with the other browser settings. **A** asks FinBIF with no informal taxon group filter. **B** ranks local birds in `app/static/birds.json` on the phone (`birds.js`): prefix Levenshtein with Finnish QWERTY neighbour substitution costs from `key-neighbours.js` (built from `keys.csv`); returns the 5 cheapest taxa and puts the matched name (Finnish, scientific, abbreviation, or synonym) in the list and the field. **C** asks FinBIF with the groups chosen in Settings. C is the default.

**Document step.** End session flushes the latest GPS fix, then opens locality + keywords (default `new`). Back to map saves the header on the session. Submit requires ≥1 observation, sets `endedAt`, `POST /api/sessions/submit`, and clears the active session on success.

**Send later** parks the session in IndexedDB `unsent` (no FinBIF post). Start lists unsent sessions; Edit restores one into the active session. **Discard** confirms, downloads a JSON file, and clears the active session.

**Settings** (header dialog, `localStorage`): informal taxon groups for autocomplete, autocomplete cache TTL, minimum route spacing. Shared limits and taxon-group labels come from the server as `#terra-config` (`client_config` in `main.py`).

## Server

`app/finbif/document.py` is the field contract. It parses the posted draft and builds one Vihko document (collection `HR.1747`, form `JX.519`):

- Gathering geometry = route (LineString, or Point if fewer than two positions; session start if empty).
- One unit per observation at its pin (session point if missing). Optional count → `unit.count`, notes → `unit.notes`. Chosen taxon id → `unitFact.autocompleteSelectedTaxonID`.
- Keywords and locality from the optional `document` object. Missing keywords → `new`. Blank locality omitted.

Unknown keys are ignored. New observation fields: `_parse_observation` + `_build_unit`. New document fields: `_parse_header` + `build_document`.

`app/finbif/submit.py` POSTs `/documents/validate`, then `/documents` if validation passes. Observer id comes from the cookie. `app/finbif/client.py` talks to api.laji.fi with access token + person token.

## Where to look

- `app/static/js/app.js` — views, start/end, document form, send later, discard, unsent
- `app/static/js/session.js` — stamps, session bundle fields for park/restore
- `app/static/js/session-map.js` — map, pin, follow, geolocation
- `app/static/js/observe.js` — observation dialog and list
- `app/static/js/route.js` — which GPS fixes become route points
- `app/static/js/db.js` — IndexedDB (no network)
- `app/static/js/api.js` — only module that calls Terra’s HTTP API
- `app/static/js/config.js` / `settings.js` — server-provided limits; browser settings
- `app/main.py` — pages, login, JSON routes, `client_config`
- `app/finbif/document.py` — parse draft, build Vihko document
- `app/finbif/submit.py` — validate, then create
- `app/finbif/taxon.py` — autocomplete
- `app/config.py` — collection, form, environment

## Todo

- Independent login.
- Robustness against api.laji.fi errors and downtime.
- Name and observation visibility. Today every document uses `secureLevel: MX.secureLevelNone` and `legPublic: True` (`document.py`).
- When app is activated, wait for location to stabilize (max 10 seconds), only then record a location fix.

## Ideas

- One-click on the observation form to ignore informal taxon groups for that autocomplete only (do not change settings).

## Removing devdots

Grey dots on the session map mark stored route points (dev only). Remove before public release; the route itself stays.

1. Delete `app/static/js/devdots.js`.
2. In `session-map.js`, delete the devdots import and every call marked `devdots`.
3. Search the repo for `devdots` and delete anything left, including this section.
