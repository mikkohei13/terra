This web app is technically called "Terra", but for users it branded as "Pica", with a production version at https://pica.biomi.org. Login is done via another app called "Havistin".

# Development guidelines:

The app is maintained by a single person. Favor simple solutions.

The app uses Python/Flask, vanilla JavaScript, and CSS. Implement business rules, server-side validation, and data processing in Python. Use JavaScript for UI behavior, IndexedDB, and browser or device APIs. For other work, default to Python unless running it in the browser provides a concrete benefit, such as offline operation or immediate feedback.

The production app is deployed to Google Cloud Run. See Makefile for details.

Add unit tests only for the most important parts of the backend code.

The app is still under development, so backwards compatibility e.g with IndexedDB is not a concern.

If something is unclear or requires major decisions, ask instead of making assumptions.

# Local run

Use Docker Compose only. Plain Python and Node are not available.

```
make dev
```

App: `http://127.0.0.1:85`. `./app` is mounted; gunicorn reloads on changes.

Compose sets `DEV_LOGIN=1`. Sign in at `http://127.0.0.1:85/dev/login` (`DEV_PERSON_TOKEN` in `.env.dev`, not deployed).

# Tests

`tests/` is not in the image. Mount it and override the entrypoint:

```
docker compose run --rm --entrypoint python -v ./tests:/terra/tests web -m unittest discover -s /terra/tests
```

