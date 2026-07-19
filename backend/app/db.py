from __future__ import annotations

import os
import sqlite3
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

_DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "dcash.sqlite"
DB_PATH = Path(os.environ.get("DCASH_DB_PATH", str(_DEFAULT_DB_PATH)))


def set_sqlite_pragmas(dbapi_connection: sqlite3.Connection, connection_record: Any) -> None:
    """Configure every new DBAPI connection for safe concurrent access.

    - WAL journal mode lets readers proceed without blocking on writers.
    - Foreign keys are off by default in SQLite and must be turned on per connection.
    Paired with ``connect_args={"timeout": 30}`` below, which makes a connection wait
    (busy_timeout) instead of immediately raising "database is locked" on contention.
    """
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


engine = create_async_engine(
    f"sqlite+aiosqlite:///{DB_PATH}",
    connect_args={"timeout": 30},
)
event.listens_for(engine.sync_engine, "connect")(set_sqlite_pragmas)
session_factory = async_sessionmaker(engine, expire_on_commit=False)


async def provide_session() -> AsyncGenerator[AsyncSession, None]:
    async with session_factory() as session:
        yield session
