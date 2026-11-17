# Terra code review

Reviewed 2026-11-17 at commit `15f47af`. Scope: all of `app/`, the tests, and the Docker, Compose and deploy files. Focus: security, and keeping the codebase easy to extend. The login method is out of scope, since it will be revised; the few login-adjacent notes are collected in one section at the end.

Nothing was executed. The findings come from reading the code, so the line references are the evidence.

## Summary

The codebase is in good shape for its size. Modules have clear, documented responsibilities, the server validates everything it forwards to FinBIF, DOM output uses `textContent` almost everywhere, tokens stay out of URLs and logs, and `.env` has never been committed.

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

### E2. The session bundle is assembled by hand in four places (fixed)

### E3. Limits and ids are duplicated across Python, JS and HTML (fixed)

### E4. Adding an observation field touches many places (fixed)

### E5. app.js is turning into the place where everything goes (fixed)

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
