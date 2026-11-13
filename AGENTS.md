
This web app is maintained by a single person. Favor simple solutions.

It is built with Python/Flask (backend and business logic) with vanilla JavaScript and CSS (frontend and UI).

The app is run locally with Docker and Docker Compose. Running it with plain Python will fail, so don't try that.  Do not use Node, as it not available on this computer.

The production app is deployed to Google Cloud Run. See Makefile for details.

Keep e2e and browser testing to minimum. I will do UI testing.

Add unit tests only for the most important parts of the backend code.

terra-spec.md provides guidelines and high-level ideas for the app. Do not edit it unless asked.

The app is still under development, so backwards compatibility e.g with IndexedDB is not a concern.

If something is unclear, ask instead of making assumptions.