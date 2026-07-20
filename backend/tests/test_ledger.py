"""E3: Core ledger — accounts, categories, transactions, transfers, ledger stream."""

from __future__ import annotations

import pytest
from litestar.testing import AsyncTestClient

from conftest import DEFAULT_EMAIL, DEFAULT_PASSWORD, MakeClient, TEST_INVITE_CODE


pytestmark = pytest.mark.anyio


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def make_account(client: AsyncTestClient, **kwargs) -> dict:
    payload = {
        "name": "Checking",
        "type": "checking",
        "currency": "EUR",
        "opening_balance_minor": 0,
        **kwargs,
    }
    resp = await client.post("/api/accounts", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def get_first_expense_category(client: AsyncTestClient) -> dict:
    """Return the first expense category (seeded at signup)."""
    resp = await client.get("/api/categories")
    assert resp.status_code == 200
    groups = resp.json()
    for g in groups:
        if g["kind"] == "expense" and g["categories"]:
            return {"group_id": g["id"], "category_id": g["categories"][0]["id"], "kind": "expense"}
    pytest.fail("No expense category found")


async def get_first_income_category(client: AsyncTestClient) -> dict:
    """Return first income category; creates one if the income group has no subcategories."""
    resp = await client.get("/api/categories")
    groups = resp.json()
    for g in groups:
        if g["kind"] == "income":
            if g["categories"]:
                return {"group_id": g["id"], "category_id": g["categories"][0]["id"], "kind": "income"}
            # Income groups are seeded without subcategories; create one for testing
            cr = await client.post("/api/categories", json={"group_id": g["id"], "name": "Salary income"})
            assert cr.status_code == 201
            return {"group_id": g["id"], "category_id": cr.json()["id"], "kind": "income"}
    pytest.fail("No income group found")


async def make_transaction(client: AsyncTestClient, account_id: int, category_id: int, **kwargs) -> dict:
    payload = {
        "account_id": account_id,
        "category_id": category_id,
        "amount_minor": 1000,
        "date": "2026-07-01",
        **kwargs,
    }
    resp = await client.post("/api/transactions", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def make_transfer(
    client: AsyncTestClient,
    from_account_id: int,
    to_account_id: int,
    from_amount: int,
    to_amount: int,
    **kwargs,
) -> dict:
    payload = {
        "from_account_id": from_account_id,
        "to_account_id": to_account_id,
        "from_amount_minor": from_amount,
        "to_amount_minor": to_amount,
        "date": "2026-07-05",
        **kwargs,
    }
    resp = await client.post("/api/transfers", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------


async def test_create_and_list_accounts(client: AsyncTestClient) -> None:
    acct = await make_account(client, name="Savings", opening_balance_minor=500_00)
    assert acct["name"] == "Savings"
    assert acct["currency"] == "EUR"
    assert acct["balance_minor"] == 500_00

    resp = await client.get("/api/accounts")
    assert resp.status_code == 200
    names = [a["name"] for a in resp.json()]
    assert "Savings" in names


async def test_account_opening_balance_reflected_in_balance(client: AsyncTestClient) -> None:
    acct = await make_account(client, opening_balance_minor=10_000_00)
    assert acct["balance_minor"] == 10_000_00


async def test_patch_account(client: AsyncTestClient) -> None:
    acct = await make_account(client, name="Old name")
    resp = await client.patch(f"/api/accounts/{acct['id']}", json={"name": "New name"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "New name"


async def test_patch_account_archive(client: AsyncTestClient) -> None:
    acct = await make_account(client)
    resp = await client.patch(f"/api/accounts/{acct['id']}", json={"archived": True})
    assert resp.status_code == 200
    assert resp.json()["archived"] is True


async def test_invalid_account_type_rejected(client: AsyncTestClient) -> None:
    resp = await client.post(
        "/api/accounts", json={"name": "X", "type": "bitcoin", "currency": "EUR"}
    )
    assert resp.status_code == 400


async def test_account_idor_different_household(make_client: MakeClient) -> None:
    owner_a = await make_client("a@example.com")
    owner_b = await make_client("b@example.com")
    acct = await make_account(owner_a, name="A's account")
    resp = await owner_b.patch(f"/api/accounts/{acct['id']}", json={"name": "Hacked"})
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Categories (seeded via seed_new_household)
# ---------------------------------------------------------------------------


async def test_categories_seeded_at_signup(client: AsyncTestClient) -> None:
    resp = await client.get("/api/categories")
    assert resp.status_code == 200
    groups = resp.json()
    expense_names = [g["name"] for g in groups if g["kind"] == "expense"]
    income_names = [g["name"] for g in groups if g["kind"] == "income"]
    assert "Housing" in expense_names
    assert "Food" in expense_names
    assert "Salary" in income_names


async def test_create_category_group(client: AsyncTestClient) -> None:
    resp = await client.post(
        "/api/categories/groups",
        json={"name": "Custom group", "kind": "expense"},
    )
    assert resp.status_code == 201
    assert resp.json()["name"] == "Custom group"
    assert resp.json()["kind"] == "expense"


async def test_create_category_in_group(client: AsyncTestClient) -> None:
    cat_info = await get_first_expense_category(client)
    resp = await client.post(
        "/api/categories",
        json={"group_id": cat_info["group_id"], "name": "New subcategory"},
    )
    assert resp.status_code == 201
    assert resp.json()["name"] == "New subcategory"


async def test_create_category_wrong_household_group(make_client: MakeClient) -> None:
    owner_a = await make_client("a@example.com")
    owner_b = await make_client("b@example.com")
    cat_a = await get_first_expense_category(owner_a)
    resp = await owner_b.post(
        "/api/categories",
        json={"group_id": cat_a["group_id"], "name": "Injected"},
    )
    assert resp.status_code == 404


async def test_patch_category(client: AsyncTestClient) -> None:
    cat_info = await get_first_expense_category(client)
    resp = await client.patch(
        f"/api/categories/{cat_info['category_id']}",
        json={"name": "Renamed"},
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed"


# ---------------------------------------------------------------------------
# Transactions
# ---------------------------------------------------------------------------


async def test_create_expense_transaction(client: AsyncTestClient) -> None:
    acct = await make_account(client)
    cat = await get_first_expense_category(client)
    tx = await make_transaction(client, acct["id"], cat["category_id"], amount_minor=5000)
    assert tx["kind"] == "expense"
    assert tx["amount_minor"] == 5000
    assert tx["currency"] == "EUR"


async def test_create_income_transaction(client: AsyncTestClient) -> None:
    acct = await make_account(client)
    cat = await get_first_income_category(client)
    tx = await make_transaction(client, acct["id"], cat["category_id"], amount_minor=200_00)
    assert tx["kind"] == "income"


async def test_transaction_amount_zero_rejected(client: AsyncTestClient) -> None:
    acct = await make_account(client)
    cat = await get_first_expense_category(client)
    resp = await client.post(
        "/api/transactions",
        json={"account_id": acct["id"], "category_id": cat["category_id"], "amount_minor": 0, "date": "2026-07-01"},
    )
    assert resp.status_code == 400


async def test_transaction_idor_account(make_client: MakeClient) -> None:
    owner_a = await make_client("a@example.com")
    owner_b = await make_client("b@example.com")
    acct_a = await make_account(owner_a)
    cat_b = await get_first_expense_category(owner_b)
    resp = await owner_b.post(
        "/api/transactions",
        json={
            "account_id": acct_a["id"],  # B trying to post to A's account
            "category_id": cat_b["category_id"],
            "amount_minor": 100,
            "date": "2026-07-01",
        },
    )
    assert resp.status_code == 404


async def test_patch_transaction(client: AsyncTestClient) -> None:
    acct = await make_account(client)
    cat = await get_first_expense_category(client)
    tx = await make_transaction(client, acct["id"], cat["category_id"])
    resp = await client.patch(f"/api/transactions/{tx['id']}", json={"amount_minor": 9999})
    assert resp.status_code == 200
    assert resp.json()["amount_minor"] == 9999


async def test_delete_transaction(client: AsyncTestClient) -> None:
    acct = await make_account(client)
    cat = await get_first_expense_category(client)
    tx = await make_transaction(client, acct["id"], cat["category_id"])
    resp = await client.delete(f"/api/transactions/{tx['id']}")
    assert resp.status_code == 204


# ---------------------------------------------------------------------------
# Transfers
# ---------------------------------------------------------------------------


async def test_create_same_currency_transfer(client: AsyncTestClient) -> None:
    checking = await make_account(client, name="Checking", opening_balance_minor=1000_00)
    savings = await make_account(client, name="Savings")
    tr = await make_transfer(client, checking["id"], savings["id"], 300_00, 300_00)
    assert tr["from_amount_minor"] == 300_00
    assert tr["to_amount_minor"] == 300_00
    assert tr["from_currency"] == "EUR"
    assert tr["to_currency"] == "EUR"


async def test_create_cross_currency_transfer(client: AsyncTestClient) -> None:
    eur_acct = await make_account(client, name="EUR", currency="EUR", opening_balance_minor=1000_00)
    usd_acct = await make_account(client, name="USD", currency="USD")
    tr = await make_transfer(client, eur_acct["id"], usd_acct["id"], 100_00, 110_00)
    assert tr["from_currency"] == "EUR"
    assert tr["to_currency"] == "USD"
    assert tr["from_amount_minor"] == 100_00
    assert tr["to_amount_minor"] == 110_00


async def test_transfer_same_account_rejected(client: AsyncTestClient) -> None:
    acct = await make_account(client)
    resp = await client.post(
        "/api/transfers",
        json={
            "from_account_id": acct["id"],
            "to_account_id": acct["id"],
            "from_amount_minor": 100,
            "to_amount_minor": 100,
            "date": "2026-07-01",
        },
    )
    assert resp.status_code == 400


async def test_transfer_idor(make_client: MakeClient) -> None:
    owner_a = await make_client("a@example.com")
    owner_b = await make_client("b@example.com")
    acct_a1 = await make_account(owner_a, name="A1")
    acct_b1 = await make_account(owner_b, name="B1")
    resp = await owner_b.post(
        "/api/transfers",
        json={
            "from_account_id": acct_a1["id"],  # A's account
            "to_account_id": acct_b1["id"],
            "from_amount_minor": 100,
            "to_amount_minor": 100,
            "date": "2026-07-01",
        },
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Balance correctness
# ---------------------------------------------------------------------------


async def test_balance_income_increases_balance(client: AsyncTestClient) -> None:
    acct = await make_account(client, opening_balance_minor=0)
    cat = await get_first_income_category(client)
    await make_transaction(client, acct["id"], cat["category_id"], amount_minor=500_00)

    resp = await client.get("/api/accounts")
    account = next(a for a in resp.json() if a["id"] == acct["id"])
    assert account["balance_minor"] == 500_00


async def test_balance_expense_decreases_balance(client: AsyncTestClient) -> None:
    acct = await make_account(client, opening_balance_minor=1000_00)
    cat = await get_first_expense_category(client)
    await make_transaction(client, acct["id"], cat["category_id"], amount_minor=300_00)

    resp = await client.get("/api/accounts")
    account = next(a for a in resp.json() if a["id"] == acct["id"])
    assert account["balance_minor"] == 700_00


async def test_negative_balance_card(client: AsyncTestClient) -> None:
    card = await make_account(client, name="Credit card", type="card", opening_balance_minor=0)
    cat = await get_first_expense_category(client)
    await make_transaction(client, card["id"], cat["category_id"], amount_minor=50_00)

    resp = await client.get("/api/accounts")
    account = next(a for a in resp.json() if a["id"] == card["id"])
    assert account["balance_minor"] == -50_00


async def test_transfer_affects_both_balances(client: AsyncTestClient) -> None:
    from_acct = await make_account(client, name="From", opening_balance_minor=500_00)
    to_acct = await make_account(client, name="To", opening_balance_minor=100_00)
    await make_transfer(client, from_acct["id"], to_acct["id"], 200_00, 200_00)

    resp = await client.get("/api/accounts")
    accounts = {a["id"]: a for a in resp.json()}
    assert accounts[from_acct["id"]]["balance_minor"] == 300_00
    assert accounts[to_acct["id"]]["balance_minor"] == 300_00


async def test_cross_currency_transfer_balance(client: AsyncTestClient) -> None:
    eur = await make_account(client, currency="EUR", opening_balance_minor=1000_00)
    rub = await make_account(client, currency="RUB", opening_balance_minor=0)
    # 100.00 EUR out → 10000.00 RUB in (implied rate)
    await make_transfer(client, eur["id"], rub["id"], 100_00, 10000_00)

    resp = await client.get("/api/accounts")
    accounts = {a["id"]: a for a in resp.json()}
    assert accounts[eur["id"]]["balance_minor"] == 900_00
    assert accounts[rub["id"]]["balance_minor"] == 10000_00


# ---------------------------------------------------------------------------
# Ledger stream
# ---------------------------------------------------------------------------


async def test_ledger_returns_transactions_in_month(client: AsyncTestClient) -> None:
    acct = await make_account(client, opening_balance_minor=1000_00)
    cat = await get_first_expense_category(client)
    await make_transaction(client, acct["id"], cat["category_id"], amount_minor=100, date="2026-07-15")
    await make_transaction(client, acct["id"], cat["category_id"], amount_minor=200, date="2026-06-15")

    resp = await client.get("/api/ledger", params={"month": "2026-07"})
    assert resp.status_code == 200
    entries = resp.json()
    assert len(entries) == 1
    assert entries[0]["type"] == "transaction"
    assert entries[0]["amount_minor"] == 100


async def test_ledger_includes_transfers(client: AsyncTestClient) -> None:
    acct1 = await make_account(client, name="A")
    acct2 = await make_account(client, name="B")
    await make_transfer(client, acct1["id"], acct2["id"], 500, 500, date="2026-07-10")

    resp = await client.get("/api/ledger", params={"month": "2026-07"})
    types = [e["type"] for e in resp.json()]
    assert "transfer" in types


async def test_ledger_sorted_by_date_desc(client: AsyncTestClient) -> None:
    acct = await make_account(client)
    cat = await get_first_expense_category(client)
    await make_transaction(client, acct["id"], cat["category_id"], date="2026-07-01")
    await make_transaction(client, acct["id"], cat["category_id"], date="2026-07-20")

    resp = await client.get("/api/ledger", params={"month": "2026-07"})
    dates = [e["date"] for e in resp.json()]
    assert dates == sorted(dates, reverse=True)


async def test_ledger_account_filter(client: AsyncTestClient) -> None:
    acct_a = await make_account(client, name="A")
    acct_b = await make_account(client, name="B")
    cat = await get_first_expense_category(client)
    await make_transaction(client, acct_a["id"], cat["category_id"], date="2026-07-01")
    await make_transaction(client, acct_b["id"], cat["category_id"], date="2026-07-01")

    resp = await client.get("/api/ledger", params={"month": "2026-07", "account_id": acct_a["id"]})
    assert resp.status_code == 200
    entries = resp.json()
    assert all(e["account_id"] == acct_a["id"] for e in entries if e["type"] == "transaction")


async def test_ledger_invalid_month(client: AsyncTestClient) -> None:
    resp = await client.get("/api/ledger", params={"month": "not-a-month"})
    assert resp.status_code == 400
