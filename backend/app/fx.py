from __future__ import annotations

import logging
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_EVEN, Decimal

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Currency, Rate

logger = logging.getLogger(__name__)

# Track last fetch date in-memory for lazy daily fetch check
_last_daily_fetch_date: date | None = None


class FrankfurterFetcher:
    """Fetcher for ECB reference rates via frankfurter.app (USD, etc., no RUB after 2022-03)."""

    BASE_URL = "https://api.frankfurter.app"

    async def fetch_rate(self, target_date: date, currency: str = "USD") -> tuple[date, Decimal] | None:
        if currency == "EUR":
            return target_date, Decimal("1.0")
        date_str = target_date.strftime("%Y-%m-%d")
        url = f"{self.BASE_URL}/{date_str}?from={currency}&to=EUR"
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=10.0) as client:
                resp = await client.get(url)
                if resp.status_code != 200:
                    return None
                data = resp.json()
                rate_val = data.get("rates", {}).get("EUR")
                actual_date_str = data.get("date")
                if rate_val is None or not actual_date_str:
                    return None
                actual_date = datetime.strptime(actual_date_str, "%Y-%m-%d").date()
                return actual_date, Decimal(str(rate_val))
        except Exception as err:
            logger.warning("Frankfurter fetch error for %s on %s: %s", currency, date_str, err)
            return None

    async def fetch_rates_range(
        self, start_date: date, end_date: date, currency: str = "USD"
    ) -> dict[date, Decimal]:
        if currency == "EUR":
            days_count = (end_date - start_date).days + 1
            return {start_date + timedelta(days=i): Decimal("1.0") for i in range(days_count)}
        if start_date > end_date:
            return {}
        s_str = start_date.strftime("%Y-%m-%d")
        e_str = end_date.strftime("%Y-%m-%d")
        url = f"{self.BASE_URL}/{s_str}..{e_str}?from={currency}&to=EUR"
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=10.0) as client:
                resp = await client.get(url)
                if resp.status_code != 200:
                    return {}
                data = resp.json()
                rates_dict = data.get("rates", {})
                result: dict[date, Decimal] = {}
                for d_str, r_map in rates_dict.items():
                    r_val = r_map.get("EUR")
                    if r_val is not None:
                        dt = datetime.strptime(d_str, "%Y-%m-%d").date()
                        result[dt] = Decimal(str(r_val))
                return result
        except Exception as err:
            logger.warning("Frankfurter range error for %s (%s..%s): %s", currency, s_str, e_str, err)
            return {}


class CBRFetcher:
    """Fetcher for official Russian Central Bank rates (cbr.ru XML) for RUB."""

    DAILY_URL = "https://www.cbr.ru/scripts/XML_daily.asp"
    DYNAMIC_URL = "https://www.cbr.ru/scripts/XML_dynamic.asp"
    EUR_CBR_ID = "R01239"

    async def fetch_rate(self, target_date: date) -> tuple[date, Decimal] | None:
        d_str = target_date.strftime("%d/%m/%Y")
        url = f"{self.DAILY_URL}?date_req={d_str}"
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=10.0) as client:
                resp = await client.get(url)
                if resp.status_code != 200:
                    return None
                root = ET.fromstring(resp.content.decode("windows-1251"))
                actual_d_str = root.attrib.get("Date")
                actual_date = target_date
                if actual_d_str:
                    try:
                        actual_date = datetime.strptime(actual_d_str, "%d.%m.%Y").date()
                    except ValueError:
                        pass

                eur_val = None
                for valute in root.findall("Valute"):
                    char_code = valute.find("CharCode")
                    if char_code is not None and char_code.text == "EUR":
                        nom_elem = valute.find("Nominal")
                        val_elem = valute.find("Value")
                        if nom_elem is not None and val_elem is not None:
                            nominal = Decimal(nom_elem.text.replace(",", "."))
                            val_str = val_elem.text.replace(",", ".")
                            eur_in_rub = Decimal(val_str) / nominal
                            rub_in_eur = Decimal("1") / eur_in_rub
                            eur_val = rub_in_eur
                        break
                if eur_val is None:
                    return None
                return actual_date, eur_val
        except Exception as err:
            logger.warning("CBR fetch error for date %s: %s", d_str, err)
            return None

    async def fetch_rates_range(self, start_date: date, end_date: date) -> dict[date, Decimal]:
        if start_date > end_date:
            return {}
        s_str = start_date.strftime("%d/%m/%Y")
        e_str = end_date.strftime("%d/%m/%Y")
        url = f"{self.DYNAMIC_URL}?date_req1={s_str}&date_req2={e_str}&VAL_NM_RQ={self.EUR_CBR_ID}"
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=10.0) as client:
                resp = await client.get(url)
                if resp.status_code != 200:
                    return {}
                root = ET.fromstring(resp.content.decode("windows-1251"))
                result: dict[date, Decimal] = {}
                for rec in root.findall("Record"):
                    d_attrib = rec.attrib.get("Date")
                    nom_elem = rec.find("Nominal")
                    val_elem = rec.find("Value")
                    if d_attrib and nom_elem is not None and val_elem is not None:
                        rec_date = datetime.strptime(d_attrib, "%d.%m.%Y").date()
                        nominal = Decimal(nom_elem.text.replace(",", "."))
                        val_str = val_elem.text.replace(",", ".")
                        eur_in_rub = Decimal(val_str) / nominal
                        result[rec_date] = Decimal("1") / eur_in_rub
                return result
        except Exception as err:
            logger.warning("CBR range error (%s..%s): %s", s_str, e_str, err)
            return {}


frankfurter_fetcher = FrankfurterFetcher()
cbr_fetcher = CBRFetcher()


async def fetch_rate_for_currency(target_date: date, currency: str) -> tuple[date, Decimal] | None:
    """Route rate fetching to the appropriate provider for currency."""
    if currency == "EUR":
        return target_date, Decimal("1.0")
    if currency == "RUB":
        return await cbr_fetcher.fetch_rate(target_date)
    return await frankfurter_fetcher.fetch_rate(target_date, currency=currency)


async def fetch_rates_range_for_currency(
    start_date: date, end_date: date, currency: str
) -> dict[date, Decimal]:
    """Route range rate fetching to the appropriate provider for currency."""
    if currency == "EUR":
        days_count = (end_date - start_date).days + 1
        return {start_date + timedelta(days=i): Decimal("1.0") for i in range(days_count)}
    if currency == "RUB":
        return await cbr_fetcher.fetch_rates_range(start_date, end_date)
    return await frankfurter_fetcher.fetch_rates_range(start_date, end_date, currency=currency)


def convert_to_eur(amount_minor: int, currency: str, rate_to_eur: Decimal) -> int:
    """Convert amount_minor in currency to minor units of EUR using half-even rounding.

    Formula: (amount_minor * rate_to_eur) rounded to integer with ROUND_HALF_EVEN.
    """
    if currency == "EUR":
        return amount_minor
    converted = (Decimal(amount_minor) * rate_to_eur).quantize(Decimal("1"), rounding=ROUND_HALF_EVEN)
    return int(converted)


async def get_rate_for_date(session: AsyncSession, currency: str, target_date: date) -> Decimal:
    """Lookup rate for (currency, target_date).

    Returns nearest previous date rate. If no rate in DB, triggers on-demand backfill.
    """
    if currency == "EUR":
        return Decimal("1.0")

    stmt = (
        select(Rate)
        .where(
            Rate.currency == currency,
            Rate.date <= target_date,
        )
        .order_by(Rate.date.desc())
        .limit(1)
    )
    existing_rate = (await session.execute(stmt)).scalar_one_or_none()
    if existing_rate is not None:
        return Decimal(existing_rate.rate_to_eur)

    # Backfill range [target_date - 7 days, target_date]
    start_d = target_date - timedelta(days=7)
    fetched_rates = await fetch_rates_range_for_currency(start_d, target_date, currency)
    if fetched_rates:
        for d_item, r_val in fetched_rates.items():
            check_stmt = select(Rate).where(Rate.currency == currency, Rate.date == d_item)
            curr_rate = (await session.execute(check_stmt)).scalar_one_or_none()
            if curr_rate is None:
                new_r = Rate(
                    date=d_item,
                    currency=currency,
                    rate_to_eur=str(r_val),
                    source="auto",
                )
                session.add(new_r)
        await session.commit()

        # Retry query
        existing_rate = (await session.execute(stmt)).scalar_one_or_none()
        if existing_rate is not None:
            return Decimal(existing_rate.rate_to_eur)

    # Fallback to nearest rate in DB regardless of date
    fb_stmt = select(Rate).where(Rate.currency == currency).order_by(Rate.date.asc()).limit(1)
    fb_rate = (await session.execute(fb_stmt)).scalar_one_or_none()
    if fb_rate is not None:
        return Decimal(fb_rate.rate_to_eur)

    return Decimal("1.0")


async def get_rates_map(
    session: AsyncSession, date_currency_pairs: set[tuple[date, str]]
) -> dict[tuple[date, str], Decimal]:
    """Batch rate resolution for a set of (date, currency) pairs."""
    result: dict[tuple[date, str], Decimal] = {}
    for d_item, curr in date_currency_pairs:
        if curr == "EUR":
            result[(d_item, curr)] = Decimal("1.0")
        else:
            result[(d_item, curr)] = await get_rate_for_date(session, curr, d_item)
    return result


async def refresh_rates_for_date(session: AsyncSession, target_date: date) -> list[Rate]:
    """Fetch current rates for all active non-EUR currencies in the database for target_date.

    Manual overrides are preserved (not overwritten by auto rates).
    """
    curr_stmt = select(Currency.code)
    curr_codes = (await session.execute(curr_stmt)).scalars().all()
    if not curr_codes:
        curr_codes = ["EUR", "USD", "RUB"]
        for c, s in [("EUR", "€"), ("USD", "$"), ("RUB", "₽")]:
            session.add(Currency(code=c, decimals=2, symbol=s))
        await session.commit()

    for code in curr_codes:
        if code == "EUR":
            # Ensure EUR rate exists
            check_eur = select(Rate).where(Rate.currency == "EUR", Rate.date == target_date)
            existing_eur = (await session.execute(check_eur)).scalar_one_or_none()
            if existing_eur is None:
                session.add(Rate(date=target_date, currency="EUR", rate_to_eur="1.0", source="auto"))
            continue

        res = await fetch_rate_for_currency(target_date, code)
        if res is not None:
            actual_d, r_val = res
            check_r = select(Rate).where(Rate.currency == code, Rate.date == actual_d)
            existing_r = (await session.execute(check_r)).scalar_one_or_none()
            if existing_r is None:
                session.add(Rate(date=actual_d, currency=code, rate_to_eur=str(r_val), source="auto"))
            elif existing_r.source != "manual":
                existing_r.rate_to_eur = str(r_val)

    await session.commit()

    # Return all rates for target_date (or nearest previous)
    rates_out: list[Rate] = []
    for code in curr_codes:
        r_stmt = (
            select(Rate)
            .where(Rate.currency == code, Rate.date <= target_date)
            .order_by(Rate.date.desc())
            .limit(1)
        )
        r_obj = (await session.execute(r_stmt)).scalar_one_or_none()
        if r_obj is not None:
            rates_out.append(r_obj)
        elif code == "EUR":
            rates_out.append(Rate(date=target_date, currency="EUR", rate_to_eur="1.0", source="auto"))

    return rates_out


async def check_lazy_daily_fx_fetch(session: AsyncSession) -> None:
    """Lazy fetch check executed on authenticated requests.

    Runs once per day. Does not throw errors if network/provider is unavailable.
    """
    global _last_daily_fetch_date
    today = date.today()
    if _last_daily_fetch_date == today:
        return
    _last_daily_fetch_date = today
    try:
        await refresh_rates_for_date(session, today)
    except Exception as err:
        logger.warning("Lazy FX fetch failed for %s: %s", today, err)
