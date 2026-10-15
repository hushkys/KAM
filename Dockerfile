# KAM as one container: the API and the built single-page frontend in the same
# process, exactly as `start.sh` runs it on a laptop.
#
# The database is NOT in the image. `data/kam.db` is ~190 MB and a container
# filesystem does not survive a deploy, so a hosted KAM points at PostgreSQL
# through DATABASE_URL and the snapshot is pushed there once with
# `scripts/migrate_to_postgres.py`. Only the ČÚZK geometry travels in the image
# (1.3 MB) — the map needs it on every request and it never changes between
# harvests.

FROM node:20-alpine AS web
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
COPY data/geo/ ./data/geo/
COPY --from=web /build/dist ./frontend/dist

# Cloud Run and Render both hand the port over in $PORT; 8000 is the local default.
ENV PORT=8000 KAM_HOST=0.0.0.0
EXPOSE 8000

# A non-root user, and a writable data dir for the cache the ingest writes.
RUN useradd --create-home --uid 10001 kam && chown -R kam:kam /app
USER kam

# KAM_WORKERS = počet procesů. Jeden proces drží jedno jádro (Python má GIL),
# takže na stroji se čtyřmi jádry patří čtyři. Cloud Run jede s jedním.
CMD ["sh", "-c", "exec python -m uvicorn kam.main:app --app-dir backend --host 0.0.0.0 --port ${PORT:-8000} --workers ${KAM_WORKERS:-1} --proxy-headers --forwarded-allow-ips='*'"]
