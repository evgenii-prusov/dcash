from __future__ import annotations

import base64
import hashlib
import os
import secrets
from datetime import UTC, datetime
from typing import Annotated, Any
from urllib.parse import urlencode

import httpx
from litestar import Request, get
from litestar.exceptions import NotFoundException
from litestar.params import Parameter
from litestar.response import Redirect
from sqlalchemy.ext.asyncio import AsyncSession

from .exceptions import OAuthError
from .seed import provision_user_oauth

# See docs/auth.md §2.2–§2.8 for the full design; this module is the implementation.
# Do not invent alternative flows/error codes.

OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10  # §2.2/§2.10: state valid for 10 minutes

GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"

GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_USER_URL = "https://api.github.com/user"
GITHUB_EMAILS_URL = "https://api.github.com/user/emails"

_PROVIDERS = ("google", "github")


def _public_url() -> str:
    return os.environ.get("DCASH_PUBLIC_URL", "http://localhost:5173")


def _redirect_uri(provider: str) -> str:
    return f"{_public_url()}/api/auth/oauth/{provider}/callback"


def _client_credentials(provider: str) -> tuple[str, str] | None:
    if provider == "google":
        client_id = os.environ.get("DCASH_GOOGLE_CLIENT_ID")
        client_secret = os.environ.get("DCASH_GOOGLE_CLIENT_SECRET")
    elif provider == "github":
        client_id = os.environ.get("DCASH_GITHUB_CLIENT_ID")
        client_secret = os.environ.get("DCASH_GITHUB_CLIENT_SECRET")
    else:
        return None
    if not client_id or not client_secret:
        return None
    return client_id, client_secret


def _error_redirect(code: str) -> Redirect:
    return Redirect(f"/welcome?oauth_error={code}", status_code=302)


def _generate_pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def _validate_state(stored: dict[str, Any] | None, provider: str, state: str | None) -> dict[str, Any]:
    if not stored or not state:
        raise OAuthError("state_mismatch")
    if stored.get("provider") != provider:
        raise OAuthError("state_mismatch")
    stored_state = stored.get("state")
    if not isinstance(stored_state, str) or not secrets.compare_digest(stored_state, state):
        raise OAuthError("state_mismatch")
    created_at_raw = stored.get("created_at")
    if not isinstance(created_at_raw, str):
        raise OAuthError("state_mismatch")
    try:
        created_at = datetime.fromisoformat(created_at_raw)
    except ValueError as exc:
        raise OAuthError("state_mismatch") from exc
    age = (datetime.now(UTC) - created_at).total_seconds()
    if age > OAUTH_STATE_MAX_AGE_SECONDS:
        raise OAuthError("state_mismatch")
    return stored


def _is_verified(value: Any) -> bool:
    if isinstance(value, str):
        return value.lower() == "true"
    return bool(value)


async def _google_profile(
    *, code: str, client_id: str, client_secret: str, redirect_uri: str, code_verifier: str | None
) -> tuple[str, str | None]:
    try:
        async with httpx.AsyncClient() as http_client:
            token_resp = await http_client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "code": code,
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code",
                    "code_verifier": code_verifier,
                },
            )
            token_resp.raise_for_status()
            access_token = token_resp.json()["access_token"]

            profile_resp = await http_client.get(
                GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            profile_resp.raise_for_status()
            profile = profile_resp.json()
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        raise OAuthError("provider_error") from exc

    sub = profile.get("sub")
    if not sub:
        raise OAuthError("provider_error")

    email = profile.get("email")
    verified_email = email.strip().lower() if email and _is_verified(profile.get("email_verified")) else None
    return str(sub), verified_email


async def _github_profile(
    *, code: str, client_id: str, client_secret: str, redirect_uri: str
) -> tuple[str, str | None]:
    try:
        async with httpx.AsyncClient() as http_client:
            token_resp = await http_client.post(
                GITHUB_TOKEN_URL,
                data={
                    "code": code,
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "redirect_uri": redirect_uri,
                },
                headers={"Accept": "application/json"},
            )
            token_resp.raise_for_status()
            access_token = token_resp.json().get("access_token")
            if not access_token:
                raise OAuthError("provider_error")

            auth_headers = {
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/vnd.github+json",
            }
            user_resp = await http_client.get(GITHUB_USER_URL, headers=auth_headers)
            user_resp.raise_for_status()
            user_json = user_resp.json()

            emails_resp = await http_client.get(GITHUB_EMAILS_URL, headers=auth_headers)
            emails_resp.raise_for_status()
            emails = emails_resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise OAuthError("provider_error") from exc

    github_id = user_json.get("id")
    if github_id is None:
        raise OAuthError("provider_error")

    verified_email = None
    for entry in emails if isinstance(emails, list) else []:
        if entry.get("primary") and entry.get("verified"):
            verified_email = entry.get("email")
            break
    verified_email = verified_email.strip().lower() if verified_email else None
    return str(github_id), verified_email


@get("/oauth/{provider:str}/login", exclude_from_auth=True)
async def oauth_login(provider: str, request: Request, invite_code: str | None = None) -> Redirect:
    if provider not in _PROVIDERS:
        raise NotFoundException()
    creds = _client_credentials(provider)
    if creds is None:
        raise NotFoundException()
    client_id, _client_secret = creds

    state = secrets.token_urlsafe(32)
    oauth_state: dict[str, Any] = {
        "provider": provider,
        "state": state,
        "code_verifier": None,
        "invite_code": invite_code,
        "created_at": datetime.now(UTC).isoformat(),
    }

    if provider == "google":
        code_verifier, code_challenge = _generate_pkce_pair()
        oauth_state["code_verifier"] = code_verifier
        params = {
            "client_id": client_id,
            "redirect_uri": _redirect_uri(provider),
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
        authorize_url = GOOGLE_AUTHORIZE_URL
    else:  # github
        params = {
            "client_id": client_id,
            "redirect_uri": _redirect_uri(provider),
            "scope": "read:user user:email",
            "state": state,
        }
        authorize_url = GITHUB_AUTHORIZE_URL

    session_data = dict(request.session)
    session_data["oauth"] = oauth_state
    request.set_session(session_data)

    return Redirect(f"{authorize_url}?{urlencode(params)}", status_code=302)


@get("/oauth/{provider:str}/callback", exclude_from_auth=True)
async def oauth_callback(
    provider: str,
    request: Request,
    session: AsyncSession,
    code: str | None = None,
    # "state" is a Litestar-reserved kwarg name (litestar.datastructures.State), so the
    # Python parameter is renamed and re-aliased to the `state` query param via Parameter.
    oauth_state_param: Annotated[str | None, Parameter(query="state")] = None,
    error: str | None = None,
) -> Redirect:
    if provider not in _PROVIDERS:
        raise NotFoundException()
    creds = _client_credentials(provider)
    if creds is None:
        raise NotFoundException()
    client_id, client_secret = creds

    # State is single-use: pop it now regardless of how this request turns out.
    session_data = dict(request.session)
    stored = session_data.pop("oauth", None)
    request.set_session(session_data)

    try:
        stored = _validate_state(stored, provider, oauth_state_param)

        if error is not None or code is None:
            raise OAuthError("provider_error")

        if provider == "google":
            provider_account_id, email = await _google_profile(
                code=code,
                client_id=client_id,
                client_secret=client_secret,
                redirect_uri=_redirect_uri(provider),
                code_verifier=stored.get("code_verifier"),
            )
        else:
            provider_account_id, email = await _github_profile(
                code=code,
                client_id=client_id,
                client_secret=client_secret,
                redirect_uri=_redirect_uri(provider),
            )

        if email is None:
            raise OAuthError("no_verified_email")

        user_id = await provision_user_oauth(
            session,
            email=email,
            provider=provider,
            provider_account_id=provider_account_id,
            invite_code=stored.get("invite_code"),
        )
    except OAuthError as exc:
        return _error_redirect(exc.code)

    request.set_session({"user_id": user_id})
    return Redirect("/", status_code=302)


@get("/providers", exclude_from_auth=True)
async def oauth_providers() -> dict[str, bool]:
    return {provider: _client_credentials(provider) is not None for provider in _PROVIDERS}
