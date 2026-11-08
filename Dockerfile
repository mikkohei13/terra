FROM python:3.11-slim

# Allow statements and log messages to immediately appear in the Knative logs
ENV PYTHONUNBUFFERED True
ENV QT_QPA_PLATFORM=offscreen
ENV PORT=8080
ENV SESSION_COOKIE_SECURE=1

WORKDIR /terra

COPY requirements.txt /tmp/requirements.txt
RUN pip3 install --no-cache-dir --prefer-binary -r /tmp/requirements.txt

RUN useradd --system --create-home --home-dir /home/appuser --shell /usr/sbin/nologin appuser
COPY --chown=appuser:appuser ./app /terra/app

USER appuser
EXPOSE 8080

CMD ["sh", "-c", "exec gunicorn --chdir /terra/app main:app -w 2 --threads 2 -b 0.0.0.0:${PORT:-8080}"]
