from datetime import UTC, datetime
from typing import Any, NamedTuple

from litestar import Request, Router, delete, get, post
from litestar.exceptions import NotFoundException, PermissionDeniedException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .fx import check_lazy_daily_fx_fetch
from .models import Household, HouseholdInvite, HouseholdMember, User
from .schemas import HouseholdOut, InviteOut, MemberOut
from .seed import generate_invite_code, invite_expires_at


class HouseholdCtx(NamedTuple):
    id: int
    role: str  # "owner" | "member"


async def provide_household(request: Request[User, Any, Any], session: AsyncSession) -> HouseholdCtx:
    member = (
        await session.execute(select(HouseholdMember).where(HouseholdMember.user_id == request.user.id))
    ).scalar_one_or_none()
    if member is None:
        raise PermissionDeniedException("User has no household")
    await check_lazy_daily_fx_fetch(session)
    return HouseholdCtx(id=member.household_id, role=member.role)


@get("/")
async def get_household(hh: HouseholdCtx, session: AsyncSession) -> HouseholdOut:
    household = await session.get(Household, hh.id)
    if household is None:
        raise NotFoundException()
    return HouseholdOut(id=household.id, name=household.name)


@get("/members")
async def list_members(hh: HouseholdCtx, session: AsyncSession) -> list[MemberOut]:
    rows = (
        await session.execute(
            select(HouseholdMember, User)
            .join(User, User.id == HouseholdMember.user_id)
            .where(HouseholdMember.household_id == hh.id)
            .order_by(HouseholdMember.joined_at)
        )
    ).all()
    return [MemberOut(id=m.id, email=u.email, role=m.role, joined_at=m.joined_at) for m, u in rows]


@delete("/members/{user_id:int}", status_code=204)
async def remove_member(user_id: int, hh: HouseholdCtx, session: AsyncSession) -> None:
    if hh.role != "owner":
        raise PermissionDeniedException("Only owners can remove members")
    member = (
        await session.execute(
            select(HouseholdMember).where(
                HouseholdMember.user_id == user_id,
                HouseholdMember.household_id == hh.id,  # IDOR: must be same household
            )
        )
    ).scalar_one_or_none()
    if member is None:
        raise NotFoundException()
    await session.delete(member)
    await session.commit()


@get("/invites")
async def list_invites(hh: HouseholdCtx, session: AsyncSession) -> list[InviteOut]:
    rows = (
        (
            await session.execute(
                select(HouseholdInvite).where(
                    HouseholdInvite.household_id == hh.id,
                    HouseholdInvite.used_by.is_(None),
                    HouseholdInvite.expires_at > datetime.now(UTC),
                )
            )
        )
        .scalars()
        .all()
    )
    return [
        InviteOut(id=inv.id, code=inv.code, expires_at=inv.expires_at, used_at=inv.used_at) for inv in rows
    ]


@post("/invites", status_code=201)
async def create_invite(
    hh: HouseholdCtx, session: AsyncSession, request: Request[User, Any, Any]
) -> InviteOut:
    if hh.role != "owner":
        raise PermissionDeniedException("Only owners can create invites")
    invite = HouseholdInvite(
        household_id=hh.id,
        code=generate_invite_code(),
        created_by=request.user.id,
        expires_at=invite_expires_at(),
    )
    session.add(invite)
    await session.commit()
    return InviteOut(id=invite.id, code=invite.code, expires_at=invite.expires_at, used_at=invite.used_at)


@delete("/invites/{invite_id:int}", status_code=204)
async def revoke_invite(invite_id: int, hh: HouseholdCtx, session: AsyncSession) -> None:
    if hh.role != "owner":
        raise PermissionDeniedException("Only owners can revoke invites")
    invite = (
        await session.execute(
            select(HouseholdInvite).where(
                HouseholdInvite.id == invite_id,
                HouseholdInvite.household_id == hh.id,  # IDOR: must be caller's household
            )
        )
    ).scalar_one_or_none()
    if invite is None:
        raise NotFoundException()
    await session.delete(invite)
    await session.commit()


household_router = Router(
    path="/api/household",
    route_handlers=[get_household, list_members, remove_member, list_invites, create_invite, revoke_invite],
)
