from __future__ import annotations

import os
import tempfile
from collections.abc import AsyncIterator, Awaitable, Callable

import pytest
from litestar.testing import AsyncTestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

# Auth config reads these at import time, so they must be set before the app import.
os.environ.setdefault("DCASH_INVITE_CODE", "test-invite-code")
os.environ.setdefault("DCASH_AUTH_RATE_LIMIT", "1000000")
os.environ.setdefault("DCASH_SESSION_DIR", tempfile.mkdtemp(prefix="dcash-test-sessions-"))
# OAuth provider creds default to "configured" so most tests don't need to think about
# them; tests exercising the "unconfigured provider" 404 path monkeypatch.delenv these.
os.environ.setdefault("DCASH_GOOGLE_CLIENT_ID", "test-google-client-id")
os.environ.setdefault("DCASH_GOOGLE_CLIENT_SECRET", "test-google-client-secret")
os.environ.setdefault("DCASH_GITHUB_CLIENT_ID", "test-github-client-id")
os.environ.setdefault("DCASH_GITHUB_CLIENT_SECRET", "test-github-client-secret")
os.environ.setdefault("DCASH_PUBLIC_URL", "http://localhost:5173")
os.environ.setdefault("DCASH_AUTO_CREATE_SCHEMA", "1")

from app import db as app_db  # noqa: E402
from app import main  # noqa: E402

TEST_INVITE_CODE = os.environ["DCASH_INVITE_CODE"]
DEFAULT_EMAIL = "test@example.com"
DEFAULT_PASSWORD = "password123"

MakeClient = Callable[..., Awaitable[AsyncTestClient]]


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
async def db(monkeypatch: pytest.MonkeyPatch, tmp_path) -> AsyncIterator[async_sessionmaker]:
    """Point the app at a throwaway SQLite file so tests never touch real data."""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'test.sqlite'}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(app_db, "engine", engine)
    monkeypatch.setattr(app_db, "session_factory", session_factory)
    yield session_factory
    await engine.dispose()


async def signup(client: AsyncTestClient, email: str, password: str = DEFAULT_PASSWORD) -> None:
    resp = await client.post(
        "/api/auth/signup",
        json={"email": email, "password": password, "invite_code": TEST_INVITE_CODE},
    )
    assert resp.status_code == 201, resp.text


@pytest.fixture
async def anon_client(db: async_sessionmaker) -> AsyncIterator[AsyncTestClient]:
    """Client with no session; its lifespan creates tables on the temp DB."""
    async with AsyncTestClient(app=main.app) as client:
        yield client


@pytest.fixture
async def client(db: async_sessionmaker) -> AsyncIterator[AsyncTestClient]:
    """Client signed up as the default user (owner of a new household)."""
    async with AsyncTestClient(app=main.app) as client:
        await signup(client, DEFAULT_EMAIL)
        yield client


@pytest.fixture
async def make_client(db: async_sessionmaker) -> AsyncIterator[MakeClient]:
    """Factory producing an authenticated client per email.

    Only the first client enters/exits the app lifespan; subsequent clients reuse
    its blocking_portal to avoid "Attempted to exit cancel scope in a different task"
    errors with Litestar's AsyncTestClient.
    """
    clients: list[AsyncTestClient] = []
    primary: AsyncTestClient | None = None

    async def _make(email: str, password: str = DEFAULT_PASSWORD) -> AsyncTestClient:
        nonlocal primary
        client = AsyncTestClient(app=main.app)
        if primary is None:
            await client.__aenter__()
            primary = client
        else:
            client.blocking_portal = primary.blocking_portal
        clients.append(client)
        await signup(client, email, password)
        return client

    yield _make
    if primary is not None:
        await primary.__aexit__(None, None, None)
