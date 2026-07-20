#!/bin/sh
set -eu

cd /app/backend
alembic upgrade head
exec litestar --app app.main:app run --host 0.0.0.0 --port 8000
