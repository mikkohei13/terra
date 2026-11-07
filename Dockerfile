FROM python:3.11-slim

# Allow statements and log messages to immediately appear in the Knative logs
ENV PYTHONUNBUFFERED True
ENV QT_QPA_PLATFORM=offscreen
ENV PORT=8080

#RUN apt-get update && \
#    apt-get install -y --no-install-recommends \
#      libgl1-mesa-dri libglib2.0-0 libsm6 libxext6 libxrender-dev libgomp1 libglu1-mesa libgl1 && \
#    rm -rf /var/lib/apt/lists/*

WORKDIR /terra

COPY requirements.txt /tmp/requirements.txt
RUN pip3 install --no-cache-dir --prefer-binary -r /tmp/requirements.txt

RUN useradd --system --create-home --home-dir /home/appuser --shell /usr/sbin/nologin appuser
COPY --chown=appuser:appuser ./app /terra/app

USER appuser
EXPOSE 8080

CMD ["sh", "-c", "exec gunicorn --chdir /havistin2/app main:app -w 2 --threads 2 -b 0.0.0.0:${PORT:-8080}"]

# Run the web service on container startup. Here we use the gunicorn
# webserver, with one worker process and 8 threads.
# For environments with multiple CPU cores, increase the number of workers
# to be equal to the cores available.
# Timeout is set to 0 to disable the timeouts of the workers to allow Cloud Run to handle instance scaling.
#CMD exec gunicorn --bind :$PORT --workers 1 --threads 8 --timeout 0 main:app

