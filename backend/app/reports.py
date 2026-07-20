import calendar
from datetime import date
from typing import Annotated

from litestar import Router, get
from litestar.exceptions import ValidationException
from litestar.params import QueryParameter
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .fx import convert_to_eur, get_rate_for_date, get_rates_map
from .household import HouseholdCtx
from .models import Account, Category, CategoryGroup, Transaction, Transfer
from .schemas import (
    CategoryRollup,
    GroupRollup,
    NetWorthPoint,
    ReportCategoriesOut,
    ReportNetWorthOut,
    ReportSummaryOut,
    SummaryAccount,
)


def _parse_month(month: str) -> tuple[date, date]:
    try:
        year, mon = int(month[:4]), int(month[5:7])
        first = date(year, mon, 1)
        last = date(year, mon, calendar.monthrange(year, mon)[1])
    except (ValueError, IndexError):
        raise ValidationException(f"month must be YYYY-MM, got '{month}'") from None
    return first, last


def _add_months(d: date, months: int) -> date:
    month = d.month - 1 + months
    year = d.year + month // 12
    month = month % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


@get("/summary")
async def get_summary(
    hh: HouseholdCtx,
    session: AsyncSession,
    month: Annotated[str, QueryParameter(name="month")],
) -> ReportSummaryOut:
    first, last = _parse_month(month)

    # Fetch transactions in month
    tx_stmt = select(Transaction).where(
        Transaction.household_id == hh.id,
        Transaction.date >= first,
        Transaction.date <= last,
    )
    tx_rows = (await session.execute(tx_stmt)).scalars().all()

    # Collect rate pairs
    rate_pairs: set[tuple[date, str]] = {(t.date, t.currency) for t in tx_rows}
    rates_map = await get_rates_map(session, rate_pairs)

    income_eur = 0
    expenses_eur = 0
    for t in tx_rows:
        r_val = rates_map.get((t.date, t.currency))
        t_eur = convert_to_eur(t.amount_minor, t.currency, r_val) if r_val is not None else t.amount_minor
        if t.kind == "income":
            income_eur += t_eur
        elif t.kind == "expense":
            expenses_eur += t_eur

    # Fetch account balances
    acct_stmt = select(Account).where(Account.household_id == hh.id).order_by(Account.sort_order, Account.id)
    accounts = (await session.execute(acct_stmt)).scalars().all()

    summary_accounts: list[SummaryAccount] = []
    if accounts:
        acct_ids = [a.id for a in accounts]

        # Calculate current balances
        tx_delta_rows = (
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
                .where(Transaction.account_id.in_(acct_ids), Transaction.household_id == hh.id)
                .group_by(Transaction.account_id)
            )
        ).all()
        tx_delta = {row[0]: row[1] for row in tx_delta_rows}

        tr_in_rows = (
            await session.execute(
                select(Transfer.to_account_id, func.sum(Transfer.to_amount_minor))
                .where(Transfer.to_account_id.in_(acct_ids), Transfer.household_id == hh.id)
                .group_by(Transfer.to_account_id)
            )
        ).all()
        tr_in = {row[0]: row[1] for row in tr_in_rows}

        tr_out_rows = (
            await session.execute(
                select(Transfer.from_account_id, func.sum(Transfer.from_amount_minor))
                .where(Transfer.from_account_id.in_(acct_ids), Transfer.household_id == hh.id)
                .group_by(Transfer.from_account_id)
            )
        ).all()
        tr_out = {row[0]: row[1] for row in tr_out_rows}

        today = date.today()
        for a in accounts:
            bal_minor = (
                a.opening_balance_minor
                + (tx_delta.get(a.id) or 0)
                + (tr_in.get(a.id) or 0)
                - (tr_out.get(a.id) or 0)
            )
            a_rate = await get_rate_for_date(session, a.currency, today)
            bal_eur = convert_to_eur(bal_minor, a.currency, a_rate)
            summary_accounts.append(
                SummaryAccount(
                    id=a.id,
                    name=a.name,
                    type=a.type,
                    currency=a.currency,
                    balance_minor=bal_minor,
                    balance_eur_minor=bal_eur,
                )
            )

    return ReportSummaryOut(
        month=month,
        income_eur_minor=income_eur,
        expenses_eur_minor=expenses_eur,
        net_eur_minor=income_eur - expenses_eur,
        accounts=summary_accounts,
    )


@get("/categories")
async def get_categories_report(
    hh: HouseholdCtx,
    session: AsyncSession,
    month: Annotated[str, QueryParameter(name="month")],
    kind: Annotated[str | None, QueryParameter(name="kind")] = "expense",
) -> ReportCategoriesOut:
    target_kind = kind if kind in ("expense", "income") else "expense"
    first, last = _parse_month(month)

    # Query transactions with category and group info
    stmt = (
        select(Transaction, Category, CategoryGroup)
        .join(Category, Category.id == Transaction.category_id)
        .join(CategoryGroup, CategoryGroup.id == Category.group_id)
        .where(
            Transaction.household_id == hh.id,
            Transaction.kind == target_kind,
            Transaction.date >= first,
            Transaction.date <= last,
        )
    )
    rows = (await session.execute(stmt)).all()

    rate_pairs: set[tuple[date, str]] = {(tx.date, tx.currency) for tx, _, _ in rows}
    rates_map = await get_rates_map(session, rate_pairs)

    # Rollup totals: group_id -> { group_name, total_eur, categories: cat_id -> { cat_name, total_eur } }
    groups_data: dict[int, dict] = {}

    for tx, cat, grp in rows:
        r_val = rates_map.get((tx.date, tx.currency))
        tx_eur = convert_to_eur(tx.amount_minor, tx.currency, r_val) if r_val is not None else tx.amount_minor

        if grp.id not in groups_data:
            groups_data[grp.id] = {
                "group_name": grp.name,
                "total_eur": 0,
                "categories": {},
            }
        g_entry = groups_data[grp.id]
        g_entry["total_eur"] += tx_eur

        cat_dict = g_entry["categories"]
        if cat.id not in cat_dict:
            cat_dict[cat.id] = {
                "category_name": cat.name,
                "total_eur": 0,
            }
        cat_dict[cat.id]["total_eur"] += tx_eur

    group_rollups: list[GroupRollup] = []
    for g_id, g_val in groups_data.items():
        cat_rollups: list[CategoryRollup] = [
            CategoryRollup(
                category_id=c_id,
                category_name=c_val["category_name"],
                total_eur_minor=c_val["total_eur"],
            )
            for c_id, c_val in g_val["categories"].items()
        ]
        cat_rollups.sort(key=lambda c: c.total_eur_minor, reverse=True)

        group_rollups.append(
            GroupRollup(
                group_id=g_id,
                group_name=g_val["group_name"],
                total_eur_minor=g_val["total_eur"],
                categories=cat_rollups,
            )
        )

    group_rollups.sort(key=lambda g: g.total_eur_minor, reverse=True)

    return ReportCategoriesOut(
        month=month,
        kind=target_kind,
        groups=group_rollups,
    )


@get("/net-worth")
async def get_net_worth_report(
    hh: HouseholdCtx,
    session: AsyncSession,
    from_param: Annotated[str | None, QueryParameter(name="from")] = None,
    to_param: Annotated[str | None, QueryParameter(name="to")] = None,
) -> ReportNetWorthOut:
    today = date.today()
    to_month_str = to_param or today.strftime("%Y-%m")
    if from_param:
        from_month_str = from_param
    else:
        # 11 months back
        start_dt = _add_months(today.replace(day=1), -11)
        from_month_str = start_dt.strftime("%Y-%m")

    first_from, _ = _parse_month(from_month_str)
    _, last_to = _parse_month(to_month_str)

    # Generate month sequence
    curr_first = first_from
    month_dates: list[tuple[str, date]] = []
    while curr_first <= last_to:
        m_str = curr_first.strftime("%Y-%m")
        _, m_last = _parse_month(m_str)
        month_dates.append((m_str, m_last))
        curr_first = _add_months(curr_first, 1)

    # Accounts
    acct_stmt = select(Account).where(Account.household_id == hh.id)
    accounts = (await session.execute(acct_stmt)).scalars().all()

    if not accounts:
        return ReportNetWorthOut(
            points=[NetWorthPoint(month=m_str, net_worth_eur_minor=0) for m_str, _ in month_dates]
        )

    points: list[NetWorthPoint] = []

    for m_str, m_last in month_dates:
        # Cumulative transactions up to m_last
        acct_ids = [a.id for a in accounts]

        tx_delta_rows = (
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
                .where(
                    Transaction.account_id.in_(acct_ids),
                    Transaction.household_id == hh.id,
                    Transaction.date <= m_last,
                )
                .group_by(Transaction.account_id)
            )
        ).all()
        tx_delta = {row[0]: row[1] for row in tx_delta_rows}

        tr_in_rows = (
            await session.execute(
                select(Transfer.to_account_id, func.sum(Transfer.to_amount_minor))
                .where(
                    Transfer.to_account_id.in_(acct_ids),
                    Transfer.household_id == hh.id,
                    Transfer.date <= m_last,
                )
                .group_by(Transfer.to_account_id)
            )
        ).all()
        tr_in = {row[0]: row[1] for row in tr_in_rows}

        tr_out_rows = (
            await session.execute(
                select(Transfer.from_account_id, func.sum(Transfer.from_amount_minor))
                .where(
                    Transfer.from_account_id.in_(acct_ids),
                    Transfer.household_id == hh.id,
                    Transfer.date <= m_last,
                )
                .group_by(Transfer.from_account_id)
            )
        ).all()
        tr_out = {row[0]: row[1] for row in tr_out_rows}

        total_net_worth_eur = 0
        for a in accounts:
            bal_minor = (
                a.opening_balance_minor
                + (tx_delta.get(a.id) or 0)
                + (tr_in.get(a.id) or 0)
                - (tr_out.get(a.id) or 0)
            )
            a_rate = await get_rate_for_date(session, a.currency, m_last)
            bal_eur = convert_to_eur(bal_minor, a.currency, a_rate)
            total_net_worth_eur += bal_eur

        points.append(NetWorthPoint(month=m_str, net_worth_eur_minor=total_net_worth_eur))

    return ReportNetWorthOut(points=points)


reports_router = Router(
    path="/api/reports",
    route_handlers=[get_summary, get_categories_report, get_net_worth_report],
)
