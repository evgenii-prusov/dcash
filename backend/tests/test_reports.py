from datetime import date

import pytest
from litestar.testing import AsyncTestClient

pytestmark = pytest.mark.anyio


async def test_reports_summary_and_categories(client: AsyncTestClient) -> None:
    today_str = date.today().strftime("%Y-%m-%d")
    month_str = date.today().strftime("%Y-%m")

    # Set rate
    await client.put(f"/api/rates/{today_str}/USD", json={"rate_to_eur": "0.90"})

    # Create account
    acct_resp = await client.post(
        "/api/accounts",
        json={"name": "USD Cash", "type": "cash", "currency": "USD", "opening_balance_minor": 10000},
    )
    assert acct_resp.status_code == 201
    acct_id = acct_resp.json()["id"]

    # Get category
    cat_resp = await client.get("/api/categories")
    groups = cat_resp.json()
    cat_id = groups[0]["categories"][0]["id"]

    # Add transaction
    tx_resp = await client.post(
        "/api/transactions",
        json={
            "account_id": acct_id,
            "category_id": cat_id,
            "amount_minor": 5000,
            "date": today_str,
        },
    )
    assert tx_resp.status_code == 201

    # Test summary endpoint
    summary_resp = await client.get(f"/api/reports/summary?month={month_str}")
    assert summary_resp.status_code == 200
    summary = summary_resp.json()
    assert summary["month"] == month_str
    assert summary["expenses_eur_minor"] == 4500  # 50 USD * 0.90 = 45 EUR
    assert summary["income_eur_minor"] == 0
    assert summary["net_eur_minor"] == -4500
    assert len(summary["accounts"]) >= 1

    # Test categories endpoint
    categories_resp = await client.get(f"/api/reports/categories?month={month_str}&kind=expense")
    assert categories_resp.status_code == 200
    cat_data = categories_resp.json()
    assert cat_data["kind"] == "expense"
    assert len(cat_data["groups"]) >= 1
    assert cat_data["groups"][0]["total_eur_minor"] == 4500


async def test_reports_net_worth(client: AsyncTestClient) -> None:
    month_str = date.today().strftime("%Y-%m")

    net_resp = await client.get(f"/api/reports/net-worth?from={month_str}&to={month_str}")
    assert net_resp.status_code == 200
    net_data = net_resp.json()
    assert len(net_data["points"]) == 1
    assert net_data["points"][0]["month"] == month_str
