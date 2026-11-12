# Terra

Terra is a mobile-first web app for recording nature observations in the field and submitting them to FinBIF (api.laji.fi).

Continue building on the existing app skeleton (Python/Flask, vanilla JavaScript and CSS). Keep it simple: one maintainer, prototype stage.

The sister app Havistin2 (`../havistin2`, https://github.com/mikkohei13/havistin2) already solves several of the same problems. Reuse its patterns:

- FinBIF API v1 calls: `app/helpers/common_helpers.py` (`fetch_finbif_api`, `post_finbif_json`)
- Building and submitting a FinBIF document: `app/havis_finbif_submit.py`
- Taxon autocomplete proxy: `/api/finbif/autocomplete/taxa` in `app/main.py`

Don't copy Havistin2's code blindly. The differences that matter are listed under each section below.

Use FinBIF collection HR.1747 and form JX.519.

## Architecture

- **Server is stateless.** Flask only serves the app and proxies FinBIF calls. Cloud Run may run several instances, so nothing may be kept in server memory between requests. Use cookie-based Flask sessions only.
- **The FinBIF access token stays on the server** (env var `FINBIF_API_TOKEN`). The browser calls Terra's own `/api/...` endpoints, never api.laji.fi directly.
- **FinBIF API v1:** send the access token as `Authorization: Bearer`, the person token as a `Person-Token` header, plus `API-Version: 1`. Don't use the old `access_token` query parameter.
- **Observation data lives on the phone in IndexedDB** until it's submitted. Call `navigator.storage.persist()` so the browser is less likely to evict it.
- **Online is assumed.** Don't build offline support yet, but keep these in separate JS modules so offline features (service worker, submit queue) can be added later:
  - IndexedDB access
  - API calls
  - UI
- **UI language:** English.
- **Map:** Leaflet with OpenStreetMap standard tiles. Include attribution and follow the OSM tile usage policy.

## Deployment

The app runs on Google Cloud Run, and the Makefile contains the deployment script. Required env vars are `FINBIF_API_TOKEN` and `FLASK_SECRET_KEY`.

Geolocation needs HTTPS. Cloud Run provides it, and localhost works on desktop, but testing on a real phone needs an HTTPS URL.

## Authentication

- The user logs in through Havistin2, which links to Terra and passes the FinBIF person token to `/login`. The Havistin2 side is built separately; Terra only implements `/login`.
- `/login` accepts `personToken` as a POST form field (preferred) or a GET parameter. On GET, redirect immediately afterwards so the token doesn't stay in the URL or browser history.
- On login, call FinBIF `/person` to validate the token and get the user's person ID (`MA.xxx`). Store the token and person ID in the Flask session.
- If FinBIF rejects the token later (expired or invalid), clear the session and show a "Log in via Havistin2" link. Unsubmitted local data must survive this.
- **Logout clears only Terra's Flask session.** Do NOT revoke the token at FinBIF the way Havistin2's logout does: the token is shared, so revoking it would also log the user out of Havistin2.
- logging out should NOT delete unsubmitted observations from the phone.

## Observation session

Only one session is active at a time. The active session and its observations are stored in IndexedDB. On page load, if an active session exists, resume it.

### Starting a session

1. Get the current location with high accuracy and save the start datetime and starting WGS84 coordinates. The starting point is the first route point.
2. Load the regional species list (see below). Show a loading state. The user can start making observations before the list has loaded.

### Regional species list (top 100)

- Use the FinBIF warehouse aggregate endpoint (`/warehouse/query/unit/aggregate`).
- **Area:** a bounding box with 50 km sides (±25 km) centred on the session's starting point.
- **Time:** day of year ±14 days from today, in each of the last 20 years.
  - Pitfall: near New Year the day-of-year window wraps around (e.g. Dec 25 – Jan 22). Verify how the API handles that; if needed, run two queries and merge the results.
- Example parameters: time=2006-01-01%2F&collectionIdNot=HR.48&coordinates=59.878092:60.445266:24.037182:25.297034:WGS84:1&season=1028%2F1125
- **Grouping and order:** aggregate by the exact taxon recorded (no merging of subspecies into species), across all taxon groups. Order by number of records, descending, and keep the first 100.
- For each taxon, keep its ID, Finnish name, scientific name, and record count. Records with no taxon link are skipped.
- The query can take several seconds. Run it once per session and store the result with the session in IndexedDB.

### Route

The app does not track location continuously, because phone battery-saving features break continuous tracking.

A location is offered to the route in three situations:

- at session start
- when the observe button is tapped
- when the app returns to the foreground (`visibilitychange`), and every 5 minutes while the app is visible

A point is added only if both of these are true:

- it is at least 100 m from every existing route point
- at least 5 minutes have passed since the last added point

While the app is visible, the map can show the user's live position (`watchPosition`). Stop watching when the page is hidden. Live positions don't go into the route unless the rules above allow it.

### Map view (main view)

- The map shows the user's position and a marker for each observation. The route is not drawn.
- A large "Observe" button opens the observation entry view.
- Tapping an observation marker opens that observation for editing.
- The view also links to the list view, "End session", and "Discard session".

### Observation entry view

**Location:** when the entry view opens, save the current GPS point and timestamp as the observation's own location and time. The user can't edit the location.

**Taxon:**

- Taxon names are shown everywhere as "Finnish name (Scientific name)", or the scientific name alone when there is no Finnish name.
- Quick picks: the first 10 of the top 100 list, shown as large buttons. The list doesn't change during the session.
- Taxon text field. While the user types, show two dropdowns:
  1. Matches from the top 100 list, filtered client-side by Finnish and scientific name and ordered by record count, descending.
  2. Matches from FinBIF `/autocomplete/taxa`, which does fuzzy matching. Use Finnish names and debounce requests.
- Choosing a taxon stores its name and taxon ID. The view has a way to clear the taxon.
- The user can also save a typed name without choosing a taxon. It is then saved as free text with no taxon ID.

**Count:** a free-text field, e.g. "5", "a lot", ">10 flowering", "3 migrating", "2 males, 3 females". It may be left empty.

The "+1" button:

- Empty field → sets it to "1".
- Exactly one integer in the text → increments that integer and keeps the rest of the text unchanged ("3 migrating" → "4 migrating").
- No integers, or more than one ("a lot", "2 males, 3 females") → the button is disabled.

**Notes:** free text.

**Wildness:** radio buttons: unknown / wild / non-wild. Default: unknown which is stored as empty.

**Actions:** "Save" returns to the map view. "Delete" (when editing an existing observation) asks for confirmation.

### List view

Shows the session's observations in the order they were added, with the taxon, count and time of each. Tapping an observation opens it for editing.

### Ending a session

1. "End session" shows a summary and asks for confirmation. A session with no observations can't be submitted; offer discarding it instead.
2. The server builds one FinBIF document and POSTs it first to `/documents/validate`. Only if validation passes does it POST to `/documents`.
3. On success, delete the session from IndexedDB and show the created document's ID. Any further editing happens on laji.fi.
4. On failure, keep everything and show FinBIF's error messages. The user can retry.

"Discard session" deletes the active session and all its observations after a confirmation.

### FinBIF document mapping

- Use collection `HR.1747` and form `JX.519` (Vihko), the same as Havistin2: **TBD, confirm**.
- One document per session, with one gathering:
  - **Gathering geometry:** the route as a GeoJSON LineString, or a Point if the route has only one distinct point.
  - **`gatheringEvent`:**
    - `dateBegin`: the session start
    - `dateEnd`: the session end
    - `leg`: the user's person ID
- One unit per observation:
  - `unitGathering.geometry`: the observation's Point
  - `unitGathering.dateBegin`: the observation's timestamp
  - `identifications[0].taxon`: the taxon name
  - `unitFact.autocompleteSelectedTaxonID`: the taxon ID, only when a taxon was chosen (same as Havistin2)
  - `count`: the count text **as-is**
    - Pitfall: Havistin2 converts count to an integer. Don't do that here.
  - `notes`: the notes text
  - Wildness: map to the matching FinBIF unit field. Check the FinBIF document schema for the exact property and values.
- Coordinates in GeoJSON are `[lon, lat]`.
- Verify against `/documents/validate` the datetime format and whether `creator`/`editor` are needed. Havistin2 hardcodes `MA.3`; don't copy that without checking.
- Development uses the production API, so test submissions create real records. Delete test documents on laji.fi after testing.

## UI requirements

The app is used outdoors, often in bad weather, with one hand and wet fingers. That means:

- reasonably large touch targets
- high contrast
- minimal typing
- no small or hover-dependent controls
- the most common flow (Observe → tap a quick pick → Save) takes three taps

