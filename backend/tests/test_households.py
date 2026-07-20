from __future__ import annotations

import pytest
from conftest import DEFAULT_PASSWORD, MakeClient
from litestar.testing import AsyncTestClient

pytestmark = pytest.mark.anyio


async def test_get_household(client: AsyncTestClient) -> None:
    resp = await client.get("/api/household/")
    assert resp.status_code == 200
    body = resp.json()
    assert "id" in body
    assert "name" in body


async def test_list_members(client: AsyncTestClient) -> None:
    resp = await client.get("/api/household/members")
    assert resp.status_code == 200
    members = resp.json()
    assert len(members) == 1
    assert members[0]["role"] == "owner"


async def test_create_and_list_invite(client: AsyncTestClient) -> None:
    resp = await client.post("/api/household/invites")
    assert resp.status_code == 201
    invite = resp.json()
    assert "code" in invite
    assert "expires_at" in invite
    assert invite["used_at"] is None

    list_resp = await client.get("/api/household/invites")
    assert list_resp.status_code == 200
    codes = [i["code"] for i in list_resp.json()]
    assert invite["code"] in codes


async def test_revoke_invite(client: AsyncTestClient) -> None:
    create = await client.post("/api/household/invites")
    invite_id = create.json()["id"]

    revoke = await client.delete(f"/api/household/invites/{invite_id}")
    assert revoke.status_code == 204

    list_resp = await client.get("/api/household/invites")
    assert all(i["id"] != invite_id for i in list_resp.json())


async def test_revoke_invite_wrong_household(make_client: MakeClient) -> None:
    """User B cannot revoke an invite created by household A."""
    owner_a = await make_client("a@example.com")
    owner_b = await make_client("b@example.com")

    create = await owner_a.post("/api/household/invites")
    invite_id = create.json()["id"]

    revoke = await owner_b.delete(f"/api/household/invites/{invite_id}")
    assert revoke.status_code == 404  # IDOR: invite is not in B's household


async def test_remove_member(make_client: MakeClient) -> None:
    owner = await make_client("owner2@example.com")

    # Create invite and use it
    invite_resp = await owner.post("/api/household/invites")
    join_code = invite_resp.json()["code"]

    from litestar.testing import AsyncTestClient as ATC

    member = ATC(app=owner.app)
    member.blocking_portal = owner.blocking_portal
    await member.post(
        "/api/auth/signup",
        json={"email": "member2@example.com", "password": DEFAULT_PASSWORD, "invite_code": join_code},
    )

    # Get member's user id via members list
    members_resp = await owner.get("/api/household/members")
    members = members_resp.json()
    member_row = next(m for m in members if m["role"] == "member")
    member_user_id = member_row["id"]

    # Owner removes member
    remove = await owner.delete(f"/api/household/members/{member_user_id}")
    assert remove.status_code == 204

    # Member can no longer access household
    after = await member.get("/api/household/")
    assert after.status_code in (401, 403)


async def test_member_cannot_create_invite(make_client: MakeClient) -> None:
    owner = await make_client("owner3@example.com")
    invite_resp = await owner.post("/api/household/invites")
    join_code = invite_resp.json()["code"]

    from litestar.testing import AsyncTestClient as ATC

    member = ATC(app=owner.app)
    member.blocking_portal = owner.blocking_portal
    await member.post(
        "/api/auth/signup",
        json={"email": "member3@example.com", "password": DEFAULT_PASSWORD, "invite_code": join_code},
    )

    resp = await member.post("/api/household/invites")
    assert resp.status_code == 403
