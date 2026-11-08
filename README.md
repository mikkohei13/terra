# Terra

Terra is a mobile-first prototype web app to make nature observations and submit them to FinBIF API.

Built with Python/Flask with vanilla JavaScript and CSS.

See terra-spec.md for specifications for the prototype.

## Deployment

The app runs on Google Cloud Run, and the Makefile contains the deployment script. Required env vars are `FINBIF_API_TOKEN` and `FLASK_SECRET_KEY`.

## Authentication

Authentication is via a separate Havistin app, which posts the FinBIF person token to `/login` as `personToken`. GET works too; Terra then redirects to `/` so the token leaves the URL. Terra checks the token with FinBIF `GET /person` and stores the token, person id, and name in a signed cookie. The access token stays in `FINBIF_API_TOKEN` on the server.

`POST /logout` clears that cookie only. It does not revoke the person token, because Havistin uses the same one.

On localhost the front page has a token field. Elsewhere it links to Havistin (`HAVISTIN_URL`).

