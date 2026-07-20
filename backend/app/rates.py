from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Annotated

from litestar import Router, get, post, put
from litestar.params import QueryParameter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .fx import refresh_rates_for_date
from .models import Currency, Rate
from .schemas import RateOut, RateOverridePayload


@get("/")
async def get_rates(
    session: AsyncSession,
    date_param: Annotated[date | None, QueryParameter(name="date")] = None,
) -> list[RateOut]:
    target_date = date_param or date.today()
    curr_stmt = select(Currency.code)
    currencies = (await session.execute(curr_stmt)).scalars().all()
    if not currencies:
        currencies = ["EUR", "USD", "RUB"]

    rates_out: list[RateOut] = []
    for code in currencies:
        if code == "EUR":
            rates_out.append(RateOut(date=target_date, currency="EUR", rate_to_eur="1.0", source="auto"))
            continue

        stmt = (
            select(Rate)
            .where(Rate.currency == code, Rate.date <= target_date)
            .order_by(Rate.date.desc())
            .limit(1)
        )
        rate = (await session.execute(stmt)).scalar_one_or_none()
        if rate is not None:
            rates_out.append(
                RateOut(
                    date=rate.date,
                    currency=rate.currency,
                    rate_to_eur=rate.rate_to_eur,
                    source=rate.source,
                )
            )
        else:
            # Fallback if not yet fetched
            rates_out.append(RateOut(date=target_date, currency=code, rate_to_eur="1.0", source="auto"))

    return rates_out


@put("/{date_val:date}/{currency_code:str}")
async def override_rate(
    date_val: date,
    currency_code: str,
    data: RateOverridePayload,
    session: AsyncSession,
) -> RateOut:
    # Validate rate value
    parsed_rate = Decimal(data.rate_to_eur)

    stmt = select(Rate).where(Rate.date == date_val, Rate.currency == currency_code)
    existing_rate = (await session.execute(stmt)).scalar_one_or_none()

    if existing_rate is not None:
        existing_rate.rate_to_eur = str(parsed_rate)
        existing_rate.source = "manual"
        rate_obj = existing_rate
    else:
        rate_obj = Rate(
            date=date_val,
            currency=currency_code,
            rate_to_eur=str(parsed_rate),
            source="manual",
        )
        session.add(rate_obj)

    await session.commit()
    return RateOut(
        date=rate_obj.date,
        currency=rate_obj.currency,
        rate_to_eur=rate_obj.rate_to_eur,
        source=rate_obj.source,
    )


@post("/refresh", status_code=200)
async def refresh_rates(session: AsyncSession) -> list[RateOut]:
    today = date.today()
    rates = await refresh_rates_for_date(session, today)
    return [
        RateOut(
            date=r.date,
            currency=r.currency,
            rate_to_eur=r.rate_to_eur,
            source=r.source,
        )
        for r in rates
    ]


rates_router = Router(
    path="/api/rates",
    route_handlers=[get_rates, override_rate, refresh_rates],
)
