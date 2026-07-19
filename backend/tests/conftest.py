from __future__ import annotations

import os
from collections.abc import AsyncIterator

import pytest
from litestar.testing import AsyncTestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

# Tests have no migration step of their own; opt into the lifespan's create_all
# (prod instead runs `alembic upgrade head` before the app starts).
os.environ.setdefault("DCASH_AUTO_CREATE_SCHEMA", "1")

from app import db as app_db  # noqa: E402
from app import main  # noqa: E402


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
async def db(monkeypatch: pytest.MonkeyPatch, tmp_path) -> AsyncIterator[async_sessionmaker]:
    """Point the app at a throwaway SQLite file so tests never touch real data.

    The app reads ``app.db.engine`` / ``app.db.session_factory`` at call time,
    so patching them here makes the whole HTTP stack use the temp DB.
    """
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'test.sqlite'}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(app_db, "engine", engine)
    monkeypatch.setattr(app_db, "session_factory", session_factory)
    yield session_factory
    await engine.dispose()


@pytest.fixture
async def anon_client(db: async_sessionmaker) -> AsyncIterator[AsyncTestClient]:
    """Client with no session; its lifespan creates tables on the temp DB."""
    async with AsyncTestClient(app=main.app) as client:
        yield client
