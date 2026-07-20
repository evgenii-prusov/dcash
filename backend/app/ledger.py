from __future__ import annotations

import calendar
from datetime import date

from litestar import Router, get
from litestar.exceptions import ValidationException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .household import HouseholdCtx
from .models import Account, Category, CategoryGroup, Transaction, Transfer
from .schemas import LedgerTransaction, LedgerTransfer


def _parse_month(month: str) -> tuple[date, date]:
    """Return (first_day, last_day) for a YYYY-MM string."""
    try:
        year, mon = int(month[:4]), int(month[5:7])
        first = date(year, mon, 1)
        last = date(year, mon, calendar.monthrange(year, mon)[1])
    except (ValueError, IndexError):
        raise ValidationException(f"month must be YYYY-MM, got '{month}'") from None
    return first, last


@get("/")
async def get_ledger(
    hh: HouseholdCtx,
    session: AsyncSession,
    month: str,
    account_id: int | None = None,
    category_id: int | None = None,
    q: str | None = None,
) -> list[LedgerTransaction | LedgerTransfer]:
    first, last = _parse_month(month)

    # --- transactions ---
    tx_query = (
        select(Transaction, Account, Category, CategoryGroup)
        .join(Account, Account.id == Transaction.account_id)
        .join(Category, Category.id == Transaction.category_id)
        .join(CategoryGroup, CategoryGroup.id == Category.group_id)
        .where(
            Transaction.household_id == hh.id,
            Transaction.date >= first,
            Transaction.date <= last,
        )
    )
    if account_id is not None:
        tx_query = tx_query.where(Transaction.account_id == account_id)
    if category_id is not None:
        tx_query = tx_query.where(Transaction.category_id == category_id)
    if q:
        pattern = f"%{q}%"
        tx_query = tx_query.where(Transaction.payee.ilike(pattern) | Transaction.note.ilike(pattern))

    tx_rows = (await session.execute(tx_query)).all()

    # --- transfers ---
    tr_query = select(Transfer).where(
        Transfer.household_id == hh.id,
        Transfer.date >= first,
        Transfer.date <= last,
    )
    if account_id is not None:
        tr_query = tr_query.where(
            (Transfer.from_account_id == account_id) | (Transfer.to_account_id == account_id)
        )
    # category filter doesn't apply to transfers; q filter applies to note
    if q:
        tr_query = tr_query.where(Transfer.note.ilike(f"%{q}%"))

    tr_rows = (await session.execute(tr_query)).scalars().all()

    # Fetch account names for transfers in bulk
    tr_account_ids = set()
    for tr in tr_rows:
        tr_account_ids.add(tr.from_account_id)
        tr_account_ids.add(tr.to_account_id)
    account_map: dict[int, Account] = {}
    if tr_account_ids:
        acct_rows = (
            (await session.execute(select(Account).where(Account.id.in_(tr_account_ids)))).scalars().all()
        )
        account_map = {a.id: a for a in acct_rows}

    entries: list[LedgerTransaction | LedgerTransfer] = []

    for tx, acct, cat, grp in tx_rows:
        entries.append(
            LedgerTransaction(
                type="transaction",
                id=tx.id,
                account_id=tx.account_id,
                account_name=acct.name,
                category_id=tx.category_id,
                category_name=cat.name,
                group_name=grp.name,
                kind=tx.kind,
                amount_minor=tx.amount_minor,
                currency=tx.currency,
                date=tx.date,
                payee=tx.payee,
                note=tx.note,
                created_at=tx.created_at,
            )
        )

    for tr in tr_rows:
        from_acct = account_map.get(tr.from_account_id)
        to_acct = account_map.get(tr.to_account_id)
        entries.append(
            LedgerTransfer(
                type="transfer",
                id=tr.id,
                from_account_id=tr.from_account_id,
                from_account_name=from_acct.name if from_acct else "",
                to_account_id=tr.to_account_id,
                to_account_name=to_acct.name if to_acct else "",
                from_amount_minor=tr.from_amount_minor,
                to_amount_minor=tr.to_amount_minor,
                from_currency=from_acct.currency if from_acct else "",
                to_currency=to_acct.currency if to_acct else "",
                date=tr.date,
                note=tr.note,
                created_at=tr.created_at,
            )
        )

    entries.sort(key=lambda e: (e.date, e.created_at), reverse=True)
    return entries


ledger_router = Router(path="/api/ledger", route_handlers=[get_ledger])
