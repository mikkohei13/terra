# Terra code review

Reviewed 2026-11-17 at commit `15f47af`. Scope: all of `app/`, the tests, and the Docker, Compose and deploy files. Focus: security, and keeping the codebase easy to extend. The login method is out of scope, since it will be revised; the few login-adjacent notes are collected in one section at the end.

Nothing was executed. The findings come from reading the code, so the line references are the evidence.

## Summary

The codebase is in good shape for its size. Modules have clear, documented responsibilities, the server validates everything it forwards to FinBIF, DOM output uses `textContent` almost everywhere, tokens stay out of URLs and logs, and `.env` has never been committed.

The items most worth acting on:

| # | Finding | Kind | Effort |
|---|---------|------|--------|
| S1 | Species name is rendered as HTML in the Leaflet tooltip (fixed) | Security (XSS) | Minutes |
| S2 | Upstream timeouts exceed the Cloud Run timeout; a retry can create a duplicate document (fixed) | Data integrity | Small |
| S3 | No request body size limit (fixed) | Security (DoS) | One line |
| S4 | No Content-Security-Policy or other security headers (fixed) | Security (hardening) | Small |
| E1 | Observation accuracy is collected but silently dropped on submit | Bug / extensibility | Small |
| E2 | The session bundle is assembled by hand in four places | Extensibility | Small |
| E3 | Limits and taxon group ids are duplicated between Python, JS and HTML | Extensibility | Small |

## Security findings

### S1. Species name is rendered as HTML in the map tooltip (fixed)

### S2. Timeouts are longer than Cloud Run allows; retries can duplicate documents (fixed)

### S3. No request body size limit (fixed)

### S4. No Content-Security-Policy or other security headers (fixed)

### S5. Upstream error bodies are forwarded to the browser (low)

`app/main.py:87-88`, `app/finbif/taxon.py:49`, `app/finbif/client.py:66,113`

`_api_error` returns `exc.details` to the client. For submit this is intended: FinBIF's validation details are what the user needs. For autocomplete and `/person`, `details` is the entire upstream response body, including `{"raw": response.text}` for non-JSON responses such as a proxy error page.

The browser renders it with `textContent`, so this is information disclosure, not XSS. Suggestion: include `details` only on the submit route, and log the rest server-side.

### S6. Local data is not tied to a user (low)

`app/static/js/db.js`, `app/static/js/app.js:581`

Logout leaves the active session and the unsent sessions in IndexedDB, by design. They are not marked with a person id. If a second person logs in on the same browser, they see the first person's sessions and would submit them under their own name.

This matters little for a personal phone. If it should be handled: store `person_id` on the session and on each unsent bundle, expose the current id to JS (it is already in the template context), and at boot hide or warn about sessions that belong to someone else.

### S7. Third-party script from a CDN (fixed)

### S8. State-changing routes rely on SameSite=Lax alone (informational)

`POST /api/sessions/submit` and `POST /logout` have no CSRF token. They are protected in practice by `SameSite=Lax` and, for submit, by `get_json` rejecting non-JSON content types (a cross-site JSON post needs a CORS preflight, which fails). This is adequate.

For cheap defence in depth, a `before_request` hook can reject any POST whose `Sec-Fetch-Site` header is present and not `same-origin`. The `/login` route must be exempt, since Havistin posts to it cross-site.

### S9. Deployment notes (informational)

- `Makefile`: `--env-vars-file=.env` stores `FLASK_SECRET_KEY` and `FINBIF_API_TOKEN` as plain environment variables, visible to anyone with view access to the Cloud Run service. Secret Manager with `--set-secrets` is the usual alternative. It is optional for a one-person project.
- `app/config.py:11`: `SESSION_COOKIE_SECURE` defaults to off and the Dockerfile turns it on. Defaulting to on, with Compose turning it off (it already sets `SESSION_COOKIE_SECURE=0`), fails safe if the image is ever run another way.
- `example.env` uses `token-here` for `FLASK_SECRET_KEY`. A comment with `python -c "import secrets; print(secrets.token_hex(32))"` makes a weak key less likely.
- `app/finbif/document.py:298,303`: every document is sent with `secureLevel: MX.secureLevelNone` and `legPublic: True`. This is a product decision, not a bug, but it is hardcoded and the user is not told that their name and exact coordinates are public.

### What is already done well

- Tokens are sent only in headers and POST bodies, never in URLs. Logging records status and error code, not messages or tokens.
- The cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- `document.py` validates types, ranges and lengths for everything it forwards, and builds the document from parsed values, so the client cannot inject arbitrary FinBIF fields. The observer id comes from the server-side session, not the request.
- Taxon group ids are checked against an allowlist; taxon ids against a strict regex.
- Jinja autoescaping is on and no template uses `|safe`.
- The container runs as a non-root user. `.env` and `.env.dev` are ignored by git, Docker and gcloud, and have never been in git history.

## Extensibility and maintainability

### E1. Observation accuracy is collected but never submitted (bug)

`app/static/js/observe.js:366-370` stores `accuracy` on the observation, and the map draws it. `app/finbif/document.py` (`_parse_observation`, `_build_unit`) never reads it, so the value is dropped on submit without any message.

This is the cost of the "unknown keys are ignored" rule: a field added on the client and forgotten on the server fails silently. Two suggestions:

- Add `accuracy` to `_parse_observation` (positive integer, with an upper bound) and map it to the matching FinBIF coordinate-accuracy field in `_build_unit`, with a test.
- Make the omission loud in future. Either reject unknown observation keys with a 400, or keep ignoring them but add one test that posts every field the form stores and asserts each one appears in the built document.

### E2. The session bundle is assembled by hand in four places

- Submit payload: `app/static/js/app.js:403-407`
- Discard file: `app/static/js/app.js:450-459`
- Send later: `app/static/js/app.js:485-493`
- Restore: `app/static/js/db.js:142-151`

Each copies `startedAt`, `lat`, `lon`, `points` and `document` field by field. A new session-level field has to be added in all four, and missing one loses data only on that path, for example only after "Send later".

Suggestion: one function that builds the bundle from the session, observations and header, and one that turns a bundle back into a session. Use the same shape for the unsent store, the discard file and the submit payload. A discarded file could then also be re-imported later with no extra format work.

### E3. Limits and ids are duplicated across Python, JS and HTML

| Value | Python | JS | HTML |
|-------|--------|----|------|
| Taxon group ids | `taxon.py:11` | `settings.js:6` | |
| Max keywords (30) | `document.py:31` | `app.js:18` | |
| Max route points (2000) | `document.py:27` | `route.js:9` | |
| Taxon, count, notes, keyword, locality lengths | `document.py:28-33` | | `index.html` `maxlength` |

AGENTS.md puts business rules in Python. Suggestion: keep the constants in Python only, pass them to the template, and render them where they are used: `maxlength="{{ limits.notes }}"` in the HTML, and one `<script type="application/json" id="terra-config">` block that JS reads at startup. This is compatible with the CSP in S4, because a JSON script block is not executed.

### E4. Adding an observation field touches many places

Today a new field means: the input in `index.html`, then `fillForm`, the clear function and `saveObservation` in `observe.js`, then `_parse_observation` and `_build_unit` in `document.py`. The server side is well documented in the module docstring. The client side is not.

A small table in `observe.js` would make the common case a one-line change:

```js
const TEXT_FIELDS = [
    { key: "count", input: countInput },
    { key: "notes", input: notesInput },
];
```

`fillForm`, the clear function and `saveObservation` then loop over it. Do this when the next field is added, not before.

### E5. app.js is turning into the place where everything goes

`app/static/js/app.js` is 699 lines and holds view switching, session start, the document form, keywords, discard, send later, the unsent list and all the wiring. `observe.js` and `session-map.js` show a pattern that works: a `create…` function that owns its DOM elements and receives callbacks.

Suggestion: when one of these areas is next changed, move it out the same way. The document view (locality, keywords, submit, back) and the unsent sessions (list, send later, restore) are the natural pieces. That leaves `app.js` with views, boot and wiring.

Two smaller things in the same area:

- `localStamp`, `round6` and `sessionIsUsable` are exported from `session-map.js` but have nothing to do with the map. A small `session.js` is a better home, together with the bundle functions from E2.
- `mapApi` is created at `app.js:50` with callbacks that use `observe`, which is assigned at line 606. It works because the callbacks run later, but it is an ordering trap. A one-line comment at the `let observe;` declaration would do.

### E6. Dead code

Unused, and safe to delete:

- `app/main.py:49` `login_required`. The API routes check the session inline instead.
- `app/finbif/client.py:124` `fetch_recent_observations`.
- `app/finbif/taxon.py:129,147` `_pick_taxon_id` and `resolve_taxon`. `_pick_taxon_id` would also raise on the localized-name dicts that `_localized_name` handles.
- `app/config.py:27` `LAJI_AUTH_TARGET`.
- `requirements.txt` `Flask-Caching`, which is never imported.
- `Dockerfile:5` `ENV QT_QPA_PLATFORM=offscreen`, left over from another project.
- `app/static/images/crosshairs-*.svg`. The icons are inlined in `index.html` and the files are not referenced.
- `app/main.py:126` the `request.method == "POST"` check. The route accepts only POST.
- Stale entries in `.dockerignore` and `.gcloudignore` (`wrangler`, `MIGRATION-SUMMARY.md`, `export/`, `import/`, `service-account-key.json`).

Dead code costs most in a one-person project, because every later reading has to work out again whether it matters.

### E7. Small duplications in main.py and api.js

- `login` and `dev_login` share the same eleven-line try/except/redirect block (`main.py:130-139`, `165-174`). One helper, `_login_and_redirect(person_token)`, covers both. The bare `except Exception` also flashes "Login failed." without logging, which will make a real failure hard to diagnose; add `app.logger.exception`.
- Both API routes repeat the logged-in check and the 401 JSON response. Replace the unused `login_required` with an `api_login_required` decorator that returns that JSON.
- `api.js` repeats the parse-body, check-ok, build-error sequence in both functions. A single `requestJson(url, options, fallbackMessage)` helper makes a third endpoint a few lines.

### E8. Tests cannot be run the documented way

AGENTS.md says the app runs only in Docker. The tests live in `tests/`, which is not mounted into the Compose container (`./app` only) and is excluded from the image by `.dockerignore`. Neither the README nor the Makefile says how to run them.

Suggestion: a `make test` target, for example `docker compose run --rm -v ./tests:/terra/tests web python -m unittest discover -s /terra/tests` with the entrypoint overridden, and one line in the README.

Coverage itself matches the stated principle. `document.py`, `taxon.py` and login are tested. The one gap worth filling is `submit.py`: that validation failure stops before create, and that the upstream error is passed through.

### E9. Smaller notes

- AGENTS.md refers to `terra-spec.md`, which was deleted in commit `5160be9`. Remove the reference or restore the file.
- User-facing messages mix languages. Most are English; `taxon.py:46,158,166` and `client.py:150` are Finnish. Pick one, or decide where translation will live before there are more strings.
- `docker-compose.yml:23-25` lists each template for `--reload-extra-file`. A new template needs a new line. Setting `app.config["TEMPLATES_AUTO_RELOAD"] = True` when `FLASK_DEBUG` is set removes the list.
- `document.py:174` uses `str(raw.get("taxon") or "")`, so a number or list becomes its string form. `_optional_text` already rejects non-strings; using the same check for the taxon is more consistent. Line 180 `isinstance(seq, int)` also accepts booleans.
- `document.py:262-263` quietly moves `endedAt` up to `startedAt` when the phone clock went backwards. This is reasonable, but worth a comment explaining why.
- `app.js:588-593`: a session that fails `sessionIsUsable` at boot is deleted along with its observations. Saving it as a file first, as discard does, would be safer for field data.
- The README describes the app as working offline, but the page and Leaflet both need the network to load. If offline start matters, a service worker is the missing piece. It is a real addition, so only if it is needed.

## Login-adjacent notes for the planned revision

Out of scope for this review, so only as a list to carry into that work:

- The person token is stored in Flask's default session cookie, which is signed but not encrypted. Anyone who obtains the cookie can read the token.
- `POST /login` accepts a cross-site form post with any valid token, which allows login CSRF: a victim can be logged in as the attacker and then submit observations into the attacker's account.
- The session has no expiry or lifetime setting.
- `_dev_login_open` trusts the `Host` header. It is safe today because `DEV_LOGIN` and `DEV_PERSON_TOKEN` are absent in production. Keep it that way.

## Suggested order

1. S1 tooltip fix and S3 body limit. Minutes each.
2. E1 accuracy. It is user-visible data loss.
3. S2 timeouts, and the "may already be saved" message.
4. S4 headers, ideally together with vendoring Leaflet (S7).
5. E6 dead code removal and E8 `make test`.
6. E2 and E3 before the next session-level or observation-level field is added.
7. E4, E5 and E7 as the relevant files are next touched.
