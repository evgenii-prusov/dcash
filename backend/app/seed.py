from __future__ import annotations

import os
import secrets
from datetime import UTC, datetime, timedelta

from litestar.exceptions import PermissionDeniedException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .exceptions import OAuthError
from .models import Category, CategoryGroup, Household, HouseholdInvite, HouseholdMember, OAuthAccount, User


async def provision_user(
    session: AsyncSession,
    *,
    email: str,
    password_hash: str | None,
    invite_code: str,
) -> tuple[User, int, str]:
    """Create a user and wire them into a household. Returns (user, household_id, role).

    Path A: invite_code matches DCASH_INVITE_CODE → new household, caller is owner.
    Path B: invite_code is a valid household_invites.code → joins existing household as member.
    Raises PermissionDeniedException if neither path resolves.
    """
    # Path B: join code → existing household
    invite = (
        await session.execute(
            select(HouseholdInvite).where(
                HouseholdInvite.code == invite_code,
                HouseholdInvite.used_by.is_(None),
                HouseholdInvite.expires_at > datetime.now(UTC),
            )
        )
    ).scalar_one_or_none()

    if invite is not None:
        user = User(email=email, password_hash=password_hash)
        session.add(user)
        await session.flush()
        session.add(HouseholdMember(user_id=user.id, household_id=invite.household_id, role="member"))
        invite.used_by = user.id
        invite.used_at = datetime.now(UTC)
        # E3: seed default category tree for the joined household (categories already exist for owner)
        return user, invite.household_id, "member"

    # Path A: global invite code → new household
    expected = os.environ.get("DCASH_INVITE_CODE", "")
    if not expected or not secrets.compare_digest(invite_code, expected):
        raise PermissionDeniedException(detail="Invalid invite code")

    user = User(email=email, password_hash=password_hash)
    session.add(user)
    await session.flush()
    household = Household(name=f"{email.split('@')[0]}'s household")
    session.add(household)
    await session.flush()
    session.add(HouseholdMember(user_id=user.id, household_id=household.id, role="owner"))
    await seed_new_household(session, household.id)
    return user, household.id, "owner"


async def provision_user_oauth(
    session: AsyncSession,
    *,
    email: str,
    provider: str,
    provider_account_id: str,
    invite_code: str | None,
) -> int:
    """Resolve or create a user from an OAuth callback. Returns the user id.

    Decision tree (§2.5):
    1. Existing OAuth link → return user_id (no invite needed)
    2. Existing email → link OAuth account, return user_id (no invite needed)
    3. New user → requires invite_code; delegates to provision_user for household creation
    """
    existing_link = (
        await session.execute(
            select(OAuthAccount).where(
                OAuthAccount.provider == provider,
                OAuthAccount.provider_account_id == provider_account_id,
            )
        )
    ).scalar_one_or_none()
    if existing_link is not None:
        return existing_link.user_id

    user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is not None:
        session.add(
            OAuthAccount(
                user_id=user.id, provider=provider, provider_account_id=provider_account_id, email=email
            )
        )
        await session.commit()
        return user.id

    if not invite_code:
        raise OAuthError("invite_required")

    try:
        new_user, _hh_id, _role = await provision_user(
            session, email=email, password_hash=None, invite_code=invite_code
        )
    except PermissionDeniedException:
        raise OAuthError("invalid_invite") from None

    session.add(
        OAuthAccount(
            user_id=new_user.id, provider=provider, provider_account_id=provider_account_id, email=email
        )
    )
    await session.commit()
    return new_user.id


def generate_invite_code() -> str:
    return secrets.token_urlsafe(32)


def invite_expires_at() -> datetime:
    return datetime.now(UTC) + timedelta(days=7)


_DEFAULT_CATEGORIES: list[tuple[str, str, list[str]]] = [
    # (group_name, kind, [subcategory_names])
    ("Housing", "expense", ["Rent", "Utilities"]),
    ("Food", "expense", ["Groceries", "Restaurants"]),
    ("Transport", "expense", ["Public transport", "Car", "Taxi"]),
    ("Health", "expense", ["Pharmacy", "Doctors", "Sport"]),
    ("Personal", "expense", ["Clothes", "Subscriptions", "Gifts"]),
    ("Leisure", "expense", ["Travel", "Entertainment"]),
    ("Other", "expense", []),
    ("Salary", "income", []),
    ("Freelance", "income", []),
    ("Interest", "income", []),
    ("Other income", "income", []),
]


async def seed_new_household(session: AsyncSession, household_id: int) -> None:
    now = datetime.now(UTC)
    for sort_g, (group_name, kind, subcats) in enumerate(_DEFAULT_CATEGORIES):
        group = CategoryGroup(
            household_id=household_id,
            name=group_name,
            kind=kind,
            sort_order=sort_g,
            created_at=now,
        )
        session.add(group)
        await session.flush()
        for sort_c, cat_name in enumerate(subcats):
            session.add(
                Category(
                    household_id=household_id,
                    group_id=group.id,
                    name=cat_name,
                    archived=False,
                    sort_order=sort_c,
                    created_at=now,
                )
            )
