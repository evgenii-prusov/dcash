from __future__ import annotations

import pytest
from litestar.testing import AsyncTestClient

pytestmark = pytest.mark.anyio


async def test_health(anon_client: AsyncTestClient) -> None:
    resp = await anon_client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


async def test_unknown_api_route_is_json_404(anon_client: AsyncTestClient) -> None:
    resp = await anon_client.get("/api/nope")
    assert resp.status_code == 404
    assert resp.json()["status_code"] == 404
