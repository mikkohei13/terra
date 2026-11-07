dev:
	docker compose up --build; docker compose down

deploy:
	gcloud run deploy terra --project=terra --port=8080 \
		--max-instances=2 --concurrency=10 --memory=512Mi \
		--timeout=40 --source . \
		--env-vars-file=.env
