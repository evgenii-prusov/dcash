from __future__ import annotations

import pytest
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import create_async_engine

from app import db as app_db

pytestmark = pytest.mark.anyio


async def test_sqlite_pragmas_applied_on_connect(tmp_path) -> None:
    """Every new DBAPI connection should get WAL journaling and FK enforcement.

    Builds a throwaway engine the same way app.db does (including connect_args
    timeout for busy_timeout behavior) and wires up the same connect listener,
    then asserts the pragmas took effect.
    """
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'pragma_test.sqlite'}",
        connect_args={"timeout": 30},
    )
    event.listens_for(engine.sync_engine, "connect")(app_db.set_sqlite_pragmas)
    try:
        async with engine.connect() as conn:
            journal_mode = (await conn.execute(text("PRAGMA journal_mode"))).scalar()
            foreign_keys = (await conn.execute(text("PRAGMA foreign_keys"))).scalar()
        assert journal_mode == "wal"
        assert foreign_keys == 1
    finally:
        await engine.dispose()
