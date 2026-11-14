# Development Principles:

This web app "Terra" is maintained by a single person. Favor simple solutions.

The app uses Python/Flask, vanilla JavaScript, and CSS. Implement business rules, server-side validation, and data processing in Python. Use JavaScript for UI behavior, IndexedDB, and browser or device APIs. For other work, default to Python unless running it in the browser provides a concrete benefit, such as offline operation or immediate feedback.

The app is run locally with Docker and Docker Compose. Running it with plain Python will fail, so don't try that.  Do not use Node, as it not available on this computer.

The production app is deployed to Google Cloud Run. See Makefile for details.

Keep e2e and browser testing to minimum. I will do UI testing.

Add unit tests only for the most important parts of the backend code.

terra-spec.md provides guidelines and high-level ideas for the app. Do not edit it unless asked.

The app is still under development, so backwards compatibility e.g with IndexedDB is not a concern.

If something is unclear, ask instead of making assumptions.