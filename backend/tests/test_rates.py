from datetime import date, timedelta
from decimal import Decimal

import pytest
from litestar.testing import AsyncTestClient

from app.fx import convert_to_eur

pytestmark = pytest.mark.anyio


def test_convert_to_eur() -> None:
    # 100 USD at 0.92 EUR/USD = 92.00 EUR (9200 cents)
    assert convert_to_eur(10000, "USD", Decimal("0.92")) == 9200
    # EUR is 1:1
    assert convert_to_eur(1500, "EUR", Decimal("1.0")) == 1500
    # 1000 RUB at 0.01112 EUR/RUB = 11.12 EUR (1112 cents)
    assert convert_to_eur(100000, "RUB", Decimal("0.01112")) == 1112


async def test_get_rates_api(client: AsyncTestClient) -> None:
    resp = await client.get("/api/rates")
    assert resp.status_code == 200
    rates = resp.json()
    currencies = {r["currency"] for r in rates}
    assert "EUR" in currencies
    assert "USD" in currencies
    assert "RUB" in currencies


async def test_override_rate(client: AsyncTestClient) -> None:
    d_str = date.today().strftime("%Y-%m-%d")
    resp = await client.put(f"/api/rates/{d_str}/USD", json={"rate_to_eur": "0.95"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["currency"] == "USD"
    assert data["rate_to_eur"] == "0.95"
    assert data["source"] == "manual"

    # Confirm GET /api/rates includes the manual override
    resp_get = await client.get(f"/api/rates?date={d_str}")
    assert resp_get.status_code == 200
    usd_rate = next(r for r in resp_get.json() if r["currency"] == "USD")
    assert usd_rate["rate_to_eur"] == "0.95"
    assert usd_rate["source"] == "manual"


async def test_rates_refresh(client: AsyncTestClient) -> None:
    resp = await client.post("/api/rates/refresh")
    assert resp.status_code == 200
    rates = resp.json()
    assert len(rates) >= 3


async def test_nearest_previous_day_lookup(client: AsyncTestClient) -> None:
    past_date = date.today() - timedelta(days=10)
    past_date_str = past_date.strftime("%Y-%m-%d")
    await client.put(f"/api/rates/{past_date_str}/USD", json={"rate_to_eur": "0.90"})

    # Query rate for past_date + 2 days (weekend scenario)
    target = past_date + timedelta(days=2)
    resp = await client.get(f"/api/rates?date={target.strftime('%Y-%m-%d')}")
    assert resp.status_code == 200
    usd_rate = next(r for r in resp.json() if r["currency"] == "USD")
    assert usd_rate["rate_to_eur"] == "0.90"


async def test_account_balance_eur(client: AsyncTestClient) -> None:
    d_str = date.today().strftime("%Y-%m-%d")
    await client.put(f"/api/rates/{d_str}/USD", json={"rate_to_eur": "0.90"})

    resp = await client.post(
        "/api/accounts",
        json={"name": "USD Cash", "type": "cash", "currency": "USD", "opening_balance_minor": 10000},
    )
    assert resp.status_code == 201
    account = resp.json()
    assert account["balance_minor"] == 10000
    assert account["balance_eur_minor"] == 9000  # 100 USD * 0.90 = 90 EUR


async def test_ledger_eur_amounts(client: AsyncTestClient) -> None:
    today_str = date.today().strftime("%Y-%m-%d")
    await client.put(f"/api/rates/{today_str}/USD", json={"rate_to_eur": "0.92"})

    acct_resp = await client.post(
        "/api/accounts",
        json={"name": "USD Account", "type": "cash", "currency": "USD", "opening_balance_minor": 50000},
    )
    acct_id = acct_resp.json()["id"]

    # Get category
    cat_resp = await client.get("/api/categories")
    groups = cat_resp.json()
    cat_id = groups[0]["categories"][0]["id"]

    tx_resp = await client.post(
        "/api/transactions",
        json={
            "account_id": acct_id,
            "category_id": cat_id,
            "amount_minor": 10000,
            "date": today_str,
        },
    )
    assert tx_resp.status_code == 201
    tx = tx_resp.json()
    assert tx["amount_eur_minor"] == 9200

    month_str = date.today().strftime("%Y-%m")
    ledger_resp = await client.get(f"/api/ledger?month={month_str}")
    assert ledger_resp.status_code == 200
    entries = ledger_resp.json()
    target_entry = next(e for e in entries if e["id"] == tx["id"] and e["type"] == "transaction")
    assert target_entry["amount_eur_minor"] == 9200
