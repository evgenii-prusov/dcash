from datetime import date

from litestar import Router, get, patch, post
from litestar.exceptions import NotFoundException, ValidationException
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .fx import convert_to_eur, get_rate_for_date
from .household import HouseholdCtx
from .models import Account, Transaction, Transfer
from .schemas import ACCOUNT_TYPES, UNSET, AccountCreate, AccountOut, AccountPatch


async def _compute_balances(
    session: AsyncSession, household_id: int, accounts: list[Account]
) -> dict[int, int]:
    if not accounts:
        return {}
    ids = [a.id for a in accounts]

    tx_rows = (
        await session.execute(
            select(
                Transaction.account_id,
                func.sum(
                    case(
                        (Transaction.kind == "income", Transaction.amount_minor),
                        else_=-Transaction.amount_minor,
                    )
                ),
            )
            .where(Transaction.account_id.in_(ids), Transaction.household_id == household_id)
            .group_by(Transaction.account_id)
        )
    ).all()
    tx_delta = {row[0]: row[1] for row in tx_rows}

    tr_in_rows = (
        await session.execute(
            select(Transfer.to_account_id, func.sum(Transfer.to_amount_minor))
            .where(Transfer.to_account_id.in_(ids), Transfer.household_id == household_id)
            .group_by(Transfer.to_account_id)
        )
    ).all()
    tr_in = {row[0]: row[1] for row in tr_in_rows}

    tr_out_rows = (
        await session.execute(
            select(Transfer.from_account_id, func.sum(Transfer.from_amount_minor))
            .where(Transfer.from_account_id.in_(ids), Transfer.household_id == household_id)
            .group_by(Transfer.from_account_id)
        )
    ).all()
    tr_out = {row[0]: row[1] for row in tr_out_rows}

    return {
        a.id: (
            a.opening_balance_minor
            + (tx_delta.get(a.id) or 0)
            + (tr_in.get(a.id) or 0)
            - (tr_out.get(a.id) or 0)
        )
        for a in accounts
    }


async def _account_out(session: AsyncSession, account: Account, balance_minor: int) -> AccountOut:
    rate_to_eur = await get_rate_for_date(session, account.currency, date.today())
    balance_eur_minor = convert_to_eur(balance_minor, account.currency, rate_to_eur)
    return AccountOut(
        id=account.id,
        name=account.name,
        type=account.type,
        currency=account.currency,
        opening_balance_minor=account.opening_balance_minor,
        balance_minor=balance_minor,
        balance_eur_minor=balance_eur_minor,
        archived=account.archived,
        sort_order=account.sort_order,
    )


@get("/")
async def list_accounts(hh: HouseholdCtx, session: AsyncSession) -> list[AccountOut]:
    accounts = (
        (
            await session.execute(
                select(Account).where(Account.household_id == hh.id).order_by(Account.sort_order, Account.id)
            )
        )
        .scalars()
        .all()
    )
    balances = await _compute_balances(session, hh.id, list(accounts))
    return [await _account_out(session, a, balances[a.id]) for a in accounts]


@post("/", status_code=201)
async def create_account(data: AccountCreate, hh: HouseholdCtx, session: AsyncSession) -> AccountOut:
    if data.type not in ACCOUNT_TYPES:
        raise ValidationException(f"Invalid account type '{data.type}'")
    if len(data.currency) != 3:
        raise ValidationException("currency must be a 3-letter code")
    account = Account(
        household_id=hh.id,
        name=data.name.strip(),
        type=data.type,
        currency=data.currency.upper(),
        opening_balance_minor=data.opening_balance_minor,
        archived=False,
        sort_order=data.sort_order,
    )
    session.add(account)
    await session.commit()
    return await _account_out(session, account, account.opening_balance_minor)


@patch("/{account_id:int}")
async def patch_account(
    account_id: int, data: AccountPatch, hh: HouseholdCtx, session: AsyncSession
) -> AccountOut:
    account = (
        await session.execute(select(Account).where(Account.id == account_id, Account.household_id == hh.id))
    ).scalar_one_or_none()
    if account is None:
        raise NotFoundException()
    if data.name is not UNSET:
        account.name = data.name.strip()  # type: ignore[union-attr]
    if data.opening_balance_minor is not UNSET:
        account.opening_balance_minor = data.opening_balance_minor  # type: ignore[assignment]
    if data.archived is not UNSET:
        account.archived = data.archived  # type: ignore[assignment]
    if data.sort_order is not UNSET:
        account.sort_order = data.sort_order  # type: ignore[assignment]
    await session.commit()
    balances = await _compute_balances(session, hh.id, [account])
    return await _account_out(session, account, balances[account.id])


accounts_router = Router(
    path="/api/accounts",
    route_handlers=[list_accounts, create_account, patch_account],
)
