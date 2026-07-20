from __future__ import annotations

import pytest
from conftest import DEFAULT_EMAIL, DEFAULT_PASSWORD, TEST_INVITE_CODE, MakeClient, signup
from litestar.testing import AsyncTestClient

pytestmark = pytest.mark.anyio


async def test_anonymous_gets_401(anon_client: AsyncTestClient) -> None:
    resp = await anon_client.get("/api/auth/me")
    assert resp.status_code == 401


async def test_signup_creates_user_and_household(anon_client: AsyncTestClient) -> None:
    resp = await anon_client.post(
        "/api/auth/signup",
        json={"email": DEFAULT_EMAIL, "password": DEFAULT_PASSWORD, "invite_code": TEST_INVITE_CODE},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["email"] == DEFAULT_EMAIL
    assert "id" in body

    # Session established — /me should return the same user
    me = await anon_client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == DEFAULT_EMAIL


async def test_wrong_invite_code_rejected(anon_client: AsyncTestClient) -> None:
    resp = await anon_client.post(
        "/api/auth/signup",
        json={"email": DEFAULT_EMAIL, "password": DEFAULT_PASSWORD, "invite_code": "wrong"},
    )
    assert resp.status_code == 403


async def test_duplicate_email_rejected(anon_client: AsyncTestClient) -> None:
    await signup(anon_client, DEFAULT_EMAIL)
    resp = await anon_client.post(
        "/api/auth/signup",
        json={"email": DEFAULT_EMAIL, "password": DEFAULT_PASSWORD, "invite_code": TEST_INVITE_CODE},
    )
    assert resp.status_code == 409


async def test_short_password_rejected(anon_client: AsyncTestClient) -> None:
    resp = await anon_client.post(
        "/api/auth/signup",
        json={"email": DEFAULT_EMAIL, "password": "short", "invite_code": TEST_INVITE_CODE},
    )
    assert resp.status_code == 400


async def test_login_logout(client: AsyncTestClient) -> None:
    me = await client.get("/api/auth/me")
    assert me.status_code == 200

    logout = await client.post("/api/auth/logout")
    assert logout.status_code == 204

    me_after = await client.get("/api/auth/me")
    assert me_after.status_code == 401


async def test_wrong_password_same_as_unknown_email(anon_client: AsyncTestClient) -> None:
    """Both wrong password and unknown email must return identical 401 (timing-safe)."""
    await signup(anon_client, DEFAULT_EMAIL)

    wrong_pw = await anon_client.post(
        "/api/auth/login",
        json={"email": DEFAULT_EMAIL, "password": "wrongpassword"},
    )
    unknown = await anon_client.post(
        "/api/auth/login",
        json={"email": "nobody@example.com", "password": DEFAULT_PASSWORD},
    )
    assert wrong_pw.status_code == 401
    assert unknown.status_code == 401
    assert wrong_pw.json()["detail"] == unknown.json()["detail"]


async def test_spa_routes_are_public(anon_client: AsyncTestClient) -> None:
    """Non-API routes (SPA client-side paths) are excluded from auth — never a 401."""
    # 404 (no built dist in test env) or 200 (dist present) — but never an auth rejection.
    resp = await anon_client.get("/accounts")
    assert resp.status_code != 401


async def test_join_code_path_two_users_same_household(make_client: MakeClient) -> None:
    """E2 acceptance test: owner signs up, creates invite, member joins via join code."""
    owner = await make_client("owner@example.com")

    # Owner creates an invite
    resp = await owner.post("/api/household/invites")
    assert resp.status_code == 201
    join_code = resp.json()["code"]

    # Member signs up with the join code (path B)
    member = AsyncTestClient(app=owner.app)
    member.blocking_portal = owner.blocking_portal
    signup_resp = await member.post(
        "/api/auth/signup",
        json={"email": "member@example.com", "password": DEFAULT_PASSWORD, "invite_code": join_code},
    )
    assert signup_resp.status_code == 201

    # Both should be in the same household
    owner_hh = await owner.get("/api/household/")
    member_hh = await member.get("/api/household/")
    assert owner_hh.status_code == 200
    assert member_hh.status_code == 200
    assert owner_hh.json()["id"] == member_hh.json()["id"]

    # Join code is single-use — reusing it must fail
    third_resp = await member.post(
        "/api/auth/signup",
        json={"email": "third@example.com", "password": DEFAULT_PASSWORD, "invite_code": join_code},
    )
    assert third_resp.status_code == 403


async def test_providers_endpoint(anon_client: AsyncTestClient) -> None:
    resp = await anon_client.get("/api/auth/providers")
    assert resp.status_code == 200
    body = resp.json()
    assert body["google"] is True
    assert body["github"] is True
