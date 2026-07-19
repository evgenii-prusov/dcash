from __future__ import annotations

import os
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path

from litestar import Litestar, Request, Response, get
from litestar.config.cors import CORSConfig
from litestar.exceptions import NotFoundException
from litestar.static_files import create_static_files_router

from . import db
from .models import Base


@asynccontextmanager
async def lifespan(app: Litestar) -> AsyncGenerator[None, None]:
    # Prod schema comes from `alembic upgrade head` (run before the app starts,
    # see the Docker entrypoint); create_all is only for tests/dev, which opt in
    # via this flag since they have no migration step of their own.
    if os.environ.get("DCASH_AUTO_CREATE_SCHEMA") == "1":
        async with db.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    yield
    await db.engine.dispose()


@get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"


def not_found_handler(request: Request, exc: NotFoundException) -> Response:
    """Serve the SPA entry point for client-side routes like /accounts or /budgets."""
    index = FRONTEND_DIST / "index.html"
    if not request.url.path.startswith("/api") and index.is_file():
        return Response(content=index.read_bytes(), media_type="text/html")
    return Response(
        content={"status_code": 404, "detail": exc.detail},
        media_type="application/json",
        status_code=404,
    )


route_handlers: list = [health]
if FRONTEND_DIST.is_dir():
    route_handlers.append(create_static_files_router(path="/", directories=[FRONTEND_DIST], html_mode=True))

app = Litestar(
    route_handlers=route_handlers,
    dependencies={"session": db.provide_session},
    lifespan=[lifespan],
    cors_config=CORSConfig(allow_origins=["http://localhost:5173"]),
    exception_handlers={NotFoundException: not_found_handler},
)
