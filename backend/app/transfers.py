from __future__ import annotations

from typing import Any

from litestar import Request, Router, delete, patch, post
from litestar.exceptions import NotFoundException, ValidationException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .household import HouseholdCtx
from .models import Account, Transfer, User
from .schemas import UNSET, TransferCreate, TransferOut, TransferPatch


async def _transfer_out(session: AsyncSession, tr: Transfer) -> TransferOut:
    from_acct = await session.get(Account, tr.from_account_id)
    to_acct = await session.get(Account, tr.to_account_id)
    return TransferOut(
        id=tr.id,
        from_account_id=tr.from_account_id,
        from_account_name=from_acct.name,  # type: ignore[union-attr]
        to_account_id=tr.to_account_id,
        to_account_name=to_acct.name,  # type: ignore[union-attr]
        from_amount_minor=tr.from_amount_minor,
        to_amount_minor=tr.to_amount_minor,
        from_currency=from_acct.currency,  # type: ignore[union-attr]
        to_currency=to_acct.currency,  # type: ignore[union-attr]
        date=tr.date,
        note=tr.note,
        created_at=tr.created_at,
    )


@post("/", status_code=201)
async def create_transfer(
    data: TransferCreate,
    hh: HouseholdCtx,
    session: AsyncSession,
    request: Request[User, Any, Any],
) -> TransferOut:
    if data.from_amount_minor <= 0 or data.to_amount_minor <= 0:
        raise ValidationException("amounts must be > 0")
    if data.from_account_id == data.to_account_id:
        raise ValidationException("from and to accounts must differ")

    from_acct = (
        await session.execute(
            select(Account).where(Account.id == data.from_account_id, Account.household_id == hh.id)
        )
    ).scalar_one_or_none()
    if from_acct is None:
        raise NotFoundException("from_account not found")

    to_acct = (
        await session.execute(
            select(Account).where(Account.id == data.to_account_id, Account.household_id == hh.id)
        )
    ).scalar_one_or_none()
    if to_acct is None:
        raise NotFoundException("to_account not found")

    tr = Transfer(
        household_id=hh.id,
        from_account_id=data.from_account_id,
        to_account_id=data.to_account_id,
        from_amount_minor=data.from_amount_minor,
        to_amount_minor=data.to_amount_minor,
        date=data.date,
        note=data.note,
        created_by=request.user.id,
    )
    session.add(tr)
    await session.commit()
    return await _transfer_out(session, tr)


@patch("/{transfer_id:int}")
async def patch_transfer(
    transfer_id: int, data: TransferPatch, hh: HouseholdCtx, session: AsyncSession
) -> TransferOut:
    tr = (
        await session.execute(
            select(Transfer).where(Transfer.id == transfer_id, Transfer.household_id == hh.id)
        )
    ).scalar_one_or_none()
    if tr is None:
        raise NotFoundException()

    if data.from_amount_minor is not UNSET:
        if data.from_amount_minor <= 0:  # type: ignore[operator]
            raise ValidationException("from_amount_minor must be > 0")
        tr.from_amount_minor = data.from_amount_minor  # type: ignore[assignment]
    if data.to_amount_minor is not UNSET:
        if data.to_amount_minor <= 0:  # type: ignore[operator]
            raise ValidationException("to_amount_minor must be > 0")
        tr.to_amount_minor = data.to_amount_minor  # type: ignore[assignment]
    if data.date is not UNSET:
        tr.date = data.date  # type: ignore[assignment]
    if data.note is not UNSET:
        tr.note = data.note  # type: ignore[assignment]

    await session.commit()
    return await _transfer_out(session, tr)


@delete("/{transfer_id:int}", status_code=204)
async def delete_transfer(transfer_id: int, hh: HouseholdCtx, session: AsyncSession) -> None:
    tr = (
        await session.execute(
            select(Transfer).where(Transfer.id == transfer_id, Transfer.household_id == hh.id)
        )
    ).scalar_one_or_none()
    if tr is None:
        raise NotFoundException()
    await session.delete(tr)
    await session.commit()


transfers_router = Router(
    path="/api/transfers",
    route_handlers=[create_transfer, patch_transfer, delete_transfer],
)
