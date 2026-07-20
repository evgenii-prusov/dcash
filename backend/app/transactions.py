from __future__ import annotations

from typing import Any

from litestar import Request, Router, delete, patch, post
from litestar.exceptions import NotFoundException, ValidationException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .household import HouseholdCtx
from .models import Account, Category, CategoryGroup, Transaction, User
from .schemas import UNSET, TransactionCreate, TransactionOut, TransactionPatch


async def _tx_out(session: AsyncSession, tx: Transaction) -> TransactionOut:
    account = await session.get(Account, tx.account_id)
    cat = await session.get(Category, tx.category_id)
    group = await session.get(CategoryGroup, cat.group_id)  # type: ignore[union-attr]
    return TransactionOut(
        id=tx.id,
        account_id=tx.account_id,
        account_name=account.name,  # type: ignore[union-attr]
        category_id=tx.category_id,
        category_name=cat.name,  # type: ignore[union-attr]
        group_name=group.name,  # type: ignore[union-attr]
        kind=tx.kind,
        amount_minor=tx.amount_minor,
        currency=tx.currency,
        date=tx.date,
        payee=tx.payee,
        note=tx.note,
        created_at=tx.created_at,
    )


@post("/", status_code=201)
async def create_transaction(
    data: TransactionCreate,
    hh: HouseholdCtx,
    session: AsyncSession,
    request: Request[User, Any, Any],
) -> TransactionOut:
    if data.amount_minor <= 0:
        raise ValidationException("amount_minor must be > 0")

    account = (
        await session.execute(
            select(Account).where(Account.id == data.account_id, Account.household_id == hh.id)
        )
    ).scalar_one_or_none()
    if account is None:
        raise NotFoundException("Account not found")

    cat = (
        await session.execute(
            select(Category).where(Category.id == data.category_id, Category.household_id == hh.id)
        )
    ).scalar_one_or_none()
    if cat is None:
        raise NotFoundException("Category not found")

    group = await session.get(CategoryGroup, cat.group_id)

    tx = Transaction(
        household_id=hh.id,
        account_id=data.account_id,
        category_id=data.category_id,
        kind=group.kind,  # type: ignore[union-attr]
        amount_minor=data.amount_minor,
        currency=account.currency,
        date=data.date,
        payee=data.payee,
        note=data.note,
        created_by=request.user.id,
    )
    session.add(tx)
    await session.commit()
    return await _tx_out(session, tx)


@patch("/{tx_id:int}")
async def patch_transaction(
    tx_id: int, data: TransactionPatch, hh: HouseholdCtx, session: AsyncSession
) -> TransactionOut:
    tx = (
        await session.execute(
            select(Transaction).where(Transaction.id == tx_id, Transaction.household_id == hh.id)
        )
    ).scalar_one_or_none()
    if tx is None:
        raise NotFoundException()

    if data.amount_minor is not UNSET:
        if data.amount_minor <= 0:  # type: ignore[operator]
            raise ValidationException("amount_minor must be > 0")
        tx.amount_minor = data.amount_minor  # type: ignore[assignment]

    if data.category_id is not UNSET:
        cat = (
            await session.execute(
                select(Category).where(Category.id == data.category_id, Category.household_id == hh.id)
            )
        ).scalar_one_or_none()
        if cat is None:
            raise NotFoundException("Category not found")
        group = await session.get(CategoryGroup, cat.group_id)
        tx.category_id = data.category_id  # type: ignore[assignment]
        tx.kind = group.kind  # type: ignore[union-attr]

    if data.date is not UNSET:
        tx.date = data.date  # type: ignore[assignment]
    if data.payee is not UNSET:
        tx.payee = data.payee  # type: ignore[assignment]
    if data.note is not UNSET:
        tx.note = data.note  # type: ignore[assignment]

    await session.commit()
    return await _tx_out(session, tx)


@delete("/{tx_id:int}", status_code=204)
async def delete_transaction(tx_id: int, hh: HouseholdCtx, session: AsyncSession) -> None:
    tx = (
        await session.execute(
            select(Transaction).where(Transaction.id == tx_id, Transaction.household_id == hh.id)
        )
    ).scalar_one_or_none()
    if tx is None:
        raise NotFoundException()
    await session.delete(tx)
    await session.commit()


transactions_router = Router(
    path="/api/transactions",
    route_handlers=[create_transaction, patch_transaction, delete_transaction],
)
