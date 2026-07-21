from typing import Any

from litestar import Request, Router, delete, get, patch, post
from litestar.exceptions import NotFoundException, ValidationException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .fx import convert_to_eur, get_rate_for_date
from .household import HouseholdCtx
from .models import Account, Category, CategoryGroup, Transaction, User
from .schemas import (
    UNSET,
    PayeeSuggestion,
    TransactionCreate,
    TransactionOut,
    TransactionPatch,
    TransactionSplitCreate,
    TransactionSplitLine,
    TransactionSplitPayload,
)

MAX_PAYEE_SUGGESTIONS = 500


async def _tx_out(session: AsyncSession, tx: Transaction) -> TransactionOut:
    account = await session.get(Account, tx.account_id)
    cat = await session.get(Category, tx.category_id)
    group = await session.get(CategoryGroup, cat.group_id)  # type: ignore[union-attr]
    rate_to_eur = await get_rate_for_date(session, tx.currency, tx.date)
    amount_eur_minor = convert_to_eur(tx.amount_minor, tx.currency, rate_to_eur)
    return TransactionOut(
        id=tx.id,
        account_id=tx.account_id,
        account_name=account.name,  # type: ignore[union-attr]
        category_id=tx.category_id,
        category_name=cat.name,  # type: ignore[union-attr]
        group_name=group.name,  # type: ignore[union-attr]
        kind=tx.kind,
        amount_minor=tx.amount_minor,
        amount_eur_minor=amount_eur_minor,
        currency=tx.currency,
        date=tx.date,
        payee=tx.payee,
        note=tx.note,
        split_group_id=tx.split_group_id,
        created_at=tx.created_at,
    )


async def _validated_split_kind(
    session: AsyncSession,
    hh: HouseholdCtx,
    lines: list[TransactionSplitLine],
    expected_total: int,
) -> str:
    """Validate a set of split lines and return the shared CategoryGroup.kind.

    Raises ValidationException / NotFoundException on any violation, mirroring
    the style of the other handlers in this module.
    """
    if len(lines) < 2:
        raise ValidationException("A split needs at least 2 lines")
    if any(line.amount_minor <= 0 for line in lines):
        raise ValidationException("Every split line amount_minor must be > 0")
    if sum(line.amount_minor for line in lines) != expected_total:
        raise ValidationException("Split lines must sum to the expected total")

    category_ids = {line.category_id for line in lines}
    cats = (
        (
            await session.execute(
                select(Category).where(Category.id.in_(category_ids), Category.household_id == hh.id)
            )
        )
        .scalars()
        .all()
    )
    if len(cats) != len(category_ids):
        raise NotFoundException("Category not found")

    group_ids = {c.group_id for c in cats}
    groups = (
        (
            await session.execute(
                select(CategoryGroup).where(
                    CategoryGroup.id.in_(group_ids), CategoryGroup.household_id == hh.id
                )
            )
        )
        .scalars()
        .all()
    )
    kinds = {g.kind for g in groups}
    if len(kinds) != 1:
        raise ValidationException("All split lines must belong to categories of the same kind")
    return kinds.pop()


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


@post("/{tx_id:int}/split", status_code=201)
async def split_transaction(
    tx_id: int, data: TransactionSplitPayload, hh: HouseholdCtx, session: AsyncSession
) -> list[TransactionOut]:
    """Split an existing transaction into N category lines summing to its amount.

    Reuses the original row as line 1 (preserving id, created_at, created_by,
    payee) rather than delete-and-recreate, and does all of the work in one
    commit — a half-split ledger would leave a wrong balance.
    """
    tx = (
        await session.execute(
            select(Transaction).where(Transaction.id == tx_id, Transaction.household_id == hh.id)
        )
    ).scalar_one_or_none()
    if tx is None:
        raise NotFoundException()
    if tx.split_group_id is not None:
        raise ValidationException("Transaction is already split")

    kind = await _validated_split_kind(session, hh, data.lines, tx.amount_minor)
    if kind != tx.kind:
        raise ValidationException("Split lines must match the transaction's kind")

    first, *rest = data.lines

    # Line 1: reuse the original row — preserves id, created_at, created_by, payee.
    tx.category_id = first.category_id
    tx.amount_minor = first.amount_minor
    tx.note = first.note if first.note is not None else tx.note
    tx.split_group_id = tx.id

    for line in rest:
        session.add(
            Transaction(
                household_id=tx.household_id,
                account_id=tx.account_id,
                category_id=line.category_id,
                kind=tx.kind,
                amount_minor=line.amount_minor,
                currency=tx.currency,
                date=tx.date,
                payee=tx.payee,
                note=line.note,
                created_by=tx.created_by,
                split_group_id=tx.id,
            )
        )

    await session.commit()

    rows = (
        (
            await session.execute(
                select(Transaction)
                .where(Transaction.split_group_id == tx.id, Transaction.household_id == hh.id)
                .order_by(Transaction.id)
            )
        )
        .scalars()
        .all()
    )
    return [await _tx_out(session, row) for row in rows]


@post("/splits", status_code=201)
async def create_split_transaction(
    data: TransactionSplitCreate,
    hh: HouseholdCtx,
    session: AsyncSession,
    request: Request[User, Any, Any],
) -> list[TransactionOut]:
    """Create an already-split entry from scratch — the omnibox inline-split flow."""
    account = (
        await session.execute(
            select(Account).where(Account.id == data.account_id, Account.household_id == hh.id)
        )
    ).scalar_one_or_none()
    if account is None:
        raise NotFoundException("Account not found")

    expected_total = sum(line.amount_minor for line in data.lines)
    kind = await _validated_split_kind(session, hh, data.lines, expected_total)

    first, *rest = data.lines

    tx = Transaction(
        household_id=hh.id,
        account_id=data.account_id,
        category_id=first.category_id,
        kind=kind,
        amount_minor=first.amount_minor,
        currency=account.currency,
        date=data.date,
        payee=data.payee,
        note=first.note if first.note is not None else data.note,
        created_by=request.user.id,
    )
    session.add(tx)
    await session.flush()  # get tx.id to use as the group id
    tx.split_group_id = tx.id

    for line in rest:
        session.add(
            Transaction(
                household_id=hh.id,
                account_id=data.account_id,
                category_id=line.category_id,
                kind=kind,
                amount_minor=line.amount_minor,
                currency=account.currency,
                date=data.date,
                payee=data.payee,
                note=line.note if line.note is not None else data.note,
                created_by=request.user.id,
                split_group_id=tx.id,
            )
        )

    await session.commit()

    rows = (
        (
            await session.execute(
                select(Transaction)
                .where(Transaction.split_group_id == tx.id, Transaction.household_id == hh.id)
                .order_by(Transaction.id)
            )
        )
        .scalars()
        .all()
    )
    return [await _tx_out(session, row) for row in rows]


@delete("/splits/{group_id:int}", status_code=204)
async def delete_split_group(group_id: int, hh: HouseholdCtx, session: AsyncSession) -> None:
    rows = (
        (
            await session.execute(
                select(Transaction).where(
                    Transaction.split_group_id == group_id, Transaction.household_id == hh.id
                )
            )
        )
        .scalars()
        .all()
    )
    if not rows:
        raise NotFoundException()
    for row in rows:
        await session.delete(row)
    await session.commit()


@get("/payees")
async def list_payees(hh: HouseholdCtx, session: AsyncSession) -> list[PayeeSuggestion]:
    """Merchant history for omnibox autocomplete — household-scoped, whole list.

    One scan over (payee, category_id, date), household-scoped like every other
    query in this module. The client filters in memory, so this is deliberately
    not a per-keystroke search endpoint.
    """
    rows = (
        await session.execute(
            select(Transaction.payee, Transaction.category_id, Transaction.date).where(
                Transaction.household_id == hh.id,
                Transaction.payee.is_not(None),
                Transaction.payee != "",
            )
        )
    ).all()

    stats: dict[str, dict[str, Any]] = {}
    for payee, category_id, tx_date in rows:
        entry = stats.setdefault(payee, {"count": 0, "last_used": tx_date, "categories": {}})
        entry["count"] += 1
        if tx_date > entry["last_used"]:
            entry["last_used"] = tx_date
        cat_counts = entry["categories"]
        cat_counts[category_id] = cat_counts.get(category_id, 0) + 1

    suggestions = [
        PayeeSuggestion(
            name=payee,
            count=data["count"],
            last_used=data["last_used"],
            top_category_id=max(data["categories"], key=lambda cid: data["categories"][cid]),
        )
        for payee, data in stats.items()
    ]
    suggestions.sort(key=lambda s: (s.count, s.last_used), reverse=True)
    return suggestions[:MAX_PAYEE_SUGGESTIONS]


transactions_router = Router(
    path="/api/transactions",
    route_handlers=[
        create_transaction,
        patch_transaction,
        delete_transaction,
        split_transaction,
        create_split_transaction,
        delete_split_group,
        list_payees,
    ],
)
