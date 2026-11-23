# Terra

Mobile-first web app for recording nature observations and submitting them as one FinBIF Vihko document.

Python/Flask owns business rules and validation. Vanilla JS owns the UI, geolocation, IndexedDB, and browser settings.

## Run

Local: `make dev` → `http://127.0.0.1:85` (Compose mounts `./app`, gunicorn reloads).

Production: `make deploy` (Cloud Run, port 8080, env from `.env`).

Required: `FINBIF_API_TOKEN`, `FLASK_SECRET_KEY`. See `example.env`. Local also uses `.env.dev`. `OPENAI_API_KEY` is optional; without it note interpretation returns 503.

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

**Map.** Start takes a GPS fix. Tap places a pin; Add obs opens the observation dialog (taxon, count, notes, accuracy in meters, then males, females, moving status, plumage, and keywords). Accuracy can be suggested from observer→pin distance, is drawn on the map, and is sent as the unit geometry radius. Route points are thinned on the phone (`route.js`: GPS accuracy cap and `minDistanceM` from settings) while the session screen is open.

**Taxon search.** The letter left of the name cycles A → B → C and is stored with the other browser settings. C is the default. Under 2 characters does not search. Input waits 300 ms, and a newer query cancels the one in flight.

**A** and **C** use `GET /api/taxa/autocomplete`. The browser does not call api.laji.fi. A sends no informal taxon group; C sends the groups chosen in Settings. The server calls FinBIF `/autocomplete/taxa` (Finnish, checklist `MR.1`, match types exact/partial/likely) and returns an MX id, a list label, and the matched name written into the field. The same query and group set are cached in IndexedDB for the Settings TTL, and FinBIF is asked at most once a second.

**B** stays on the phone. `birds.js` ranks `app/static/birds.json` with prefix Levenshtein and Finnish QWERTY neighbour costs (`key-neighbours.js`, from `keys.csv`) and keeps the 5 cheapest. The hit may be the Finnish name, scientific name, abbreviation, or synonym. Words after that name are copied into notes.

A chosen id is kept only while the field still shows that name. Free text, or a name the user then edits, is saved with no `taxonId`.

**Note interpretation.** Runs on the first save only, and only when the notes are non-blank and count, males, females, moving status, and plumage are all empty. The phone saves immediately with `interpretationState: "pending"`, closes the dialog, and returns to the map. If any of those fields was filled, it saves the typed values and the list shows a muted **Skipped**. An edit never starts a call. While any row is pending, Edit, End session, Submit, and Send later are blocked with a short wait message. Discard and Back to map stay available.

`interpret-runner.js` runs while the map or the document step is on screen, one request at a time: `POST /api/observations/interpret` with `{notes}` and a 20 s abort. A 200 object is written onto the row and marked done, including an object with no fields, and the observation keyword `llm-interpreted` is appended when missing. Timeout, network error, 429, and 503 leave the row pending and the runner moves on, waiting 5 s when nothing else is pending. Anything else, including a body that is not an object, is **Not interpreted**. The notes stay visible. Pending adds a muted **Interpreting**. The observation dialog can add and remove keywords the same way as the document form.

`app/interpret/` holds the prompt, the JSON schema, and the validator. It stores nothing. Before the model it lowercases the notes except uppercase `Ä`, then rewrites `naaras puku`, `koiras puku`, and `juhla puku` into one word. The user message is those prepared notes only. Model `gpt-6-luna`, reasoning effort low, 20 s. Unknown keys are ignored; a bad field is dropped and the rest stay. `countArray` of positive integers becomes text `count` (`1,3`). Sex counts accept an integer or a digit string and drop 0, negatives, and fractions. Moving status and plumage keep only allowed values. Empty or unusable model output fails the row. A missing `OPENAI_API_KEY` does not stop the app; the route returns 503. The image needs the `openai` package.

On the Vihko unit, sex counts are integers, `movingStatus` is those short codes, `birdPlumage` is one `MY.birdPlumage*` value (`Ad`, `Jp`, `Juv`, `Kpuk`, `Npuk`, `Pull`, `Subad`), and observation keywords become `unit.keywords`. `interpretationState` is not sent.

**Document step.** End session flushes the latest GPS fix, then opens locality + keywords (default `new`). Back to map saves the header on the session. Submit requires ≥1 observation, sets `endedAt`, `POST /api/sessions/submit`, and clears the active session on success.

**Send later** parks the session in IndexedDB `unsent` (no FinBIF post). Start lists unsent sessions; Edit restores one into the active session. **Discard** confirms, downloads a JSON file, and clears the active session.

**Settings** (header dialog, `localStorage`): informal taxon groups for autocomplete, autocomplete cache TTL, minimum route spacing. Shared limits and taxon-group labels come from the server as `#terra-config` (`client_config` in `main.py`).

## Server

`app/finbif/document.py` is the field contract. It parses the posted draft and builds one Vihko document (collection `HR.1747`, form `JX.519`):

- Gathering geometry = route (LineString, or Point if fewer than two positions; session start if empty).
- One unit per observation at its pin (session point if missing). Optional count → `unit.count`, notes → `unit.notes`. Male and female counts are integers. `movingStatus` keeps the short codes. `birdPlumage` is one `MY.birdPlumage*` value. Observation keywords → `unit.keywords`. Chosen taxon id → `unitFact.autocompleteSelectedTaxonID`. `interpretationState` is ignored.
- Keywords and locality from the optional `document` object. Missing keywords → `new`. Blank locality omitted.

Unknown keys are ignored. New observation fields: `_parse_observation` + `_build_unit`. New document fields: `_parse_header` + `build_document`.

`app/finbif/submit.py` POSTs `/documents/validate`, then `/documents` if validation passes. Observer id comes from the cookie. `app/finbif/client.py` talks to api.laji.fi with access token + person token.

## Where to look

- `app/static/js/app.js` — views, start/end, document form, send later, discard, unsent
- `app/static/js/session.js` — stamps, session bundle fields for park/restore
- `app/static/js/session-map.js` — map, pin, follow, geolocation
- `app/static/js/observe.js` — observation dialog, list, first-save interpretation rules
- `app/static/js/interpret-runner.js` — one pending interpretation at a time
- `app/static/js/route.js` — which GPS fixes become route points
- `app/static/js/db.js` — IndexedDB (no network)
- `app/static/js/api.js` — only module that calls Terra’s HTTP API
- `app/static/js/config.js` / `settings.js` — server-provided limits; browser settings
- `app/main.py` — pages, login, JSON routes, `client_config`
- `app/finbif/document.py` — parse draft, build Vihko document
- `app/finbif/submit.py` — validate, then create
- `app/finbif/taxon.py` — FinBIF autocomplete proxy
- `app/interpret/` — note interpretation: prompt, schema, validator, OpenAI call
- `app/config.py` — collection, form, environment

## Todo

- Independent login.
- Bounding box instead of a path.
- Edit buttons with species name etc.
- List to show nearest observations or ordered by entruy time ascending, based on user settings.
- Robustness against api.laji.fi errors and downtime.
- Name and observation visibility. Today every document uses `secureLevel: MX.secureLevelNone` and `legPublic: True` (`document.py`).
- When app is activated, wait for location to stabilize (max 10 seconds), only then record a location fix.
- MML maps.
- Finnish language.

### Usability improvements

- Session view:
    - Observations should be ordered from newest to oldest.
- Observation modal:
    - First item of the dropdown should be highlighted with ligh yellow background. (Maybe only if it resembles well enough the text entered by the user.)
    - When open and is scrolled, the underlying session view should not scroll.
    - Fields should have labels that are always visible.
    - Save button should be always visible, e.g. vertically on the right edge.

## Removing devdots

Grey dots on the session map mark stored route points (dev only). Remove before public release; the route itself stays.

1. Delete `app/static/js/devdots.js`.
2. In `session-map.js`, delete the devdots import and every call marked `devdots`.
3. Search the repo for `devdots` and delete anything left, including this section.
