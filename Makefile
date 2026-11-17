dev:
	docker compose up --build; docker compose down

deploy:
	# 80s outlasts validate + create (about 60s) and the 70s gunicorn limit.
	gcloud run deploy terra --project=havistin --port=8080 \
		--max-instances=2 --concurrency=10 --memory=512Mi \
		--timeout=80 --source . \
		--env-vars-file=.env

dup:
	docker compose up; docker compose down;