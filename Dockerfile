### Stage 1: build the frontend static assets
FROM node:22-alpine AS frontend-build
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

### Stage 2: Python runtime
FROM python:3.13-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends sqlite3 \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv

WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend/ ./
COPY --from=frontend-build /src/frontend/dist /app/frontend/dist
COPY scripts/ /app/scripts/

COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

ENV PATH="/app/backend/.venv/bin:${PATH}"
EXPOSE 8000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
