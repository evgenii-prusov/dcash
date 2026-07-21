"""E3: Core ledger — accounts, categories, transactions, transfers, ledger stream."""

from __future__ import annotations

import pytest
from conftest import MakeClient
from litestar.testing import AsyncTestClient

pytestmark = pytest.mark.anyio


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def make_account(client: AsyncTestClient, **kwargs) -> dict:
    payload = {
        "name": "Savings",
        "type": "savings",
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
    resp = await client.post("/api/accounts", json={"name": "X", "type": "bitcoin", "currency": "EUR"})
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
        json={
            "account_id": acct["id"],
            "category_id": cat["category_id"],
            "amount_minor": 0,
            "date": "2026-07-01",
        },
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


# ---------------------------------------------------------------------------
# Transaction splits
# ---------------------------------------------------------------------------


async def get_expense_category_ids(client: AsyncTestClient, n: int) -> list[int]:
    """Return n distinct expense category ids (seeded households have plenty)."""
    resp = await client.get("/api/categories")
    ids: list[int] = []
    for g in resp.json():
        if g["kind"] == "expense":
            for c in g["categories"]:
                ids.append(c["id"])
                if len(ids) == n:
                    return ids
    pytest.fail(f"Not enough expense categories (found {len(ids)}, need {n})")


async def get_account_balance(client: AsyncTestClient, account_id: int, month: str) -> int:
    resp = await client.get("/api/reports/summary", params={"month": month})
    assert resp.status_code == 200, resp.text
    account = next(a for a in resp.json()["accounts"] if a["id"] == account_id)
    return account["balance_minor"]


async def test_split_existing_transaction_happy_path(client: AsyncTestClient) -> None:
    acct = await make_account(client, opening_balance_minor=1000_00)
    cat = await get_first_expense_category(client)
    tx = await make_transaction(client, acct["id"], cat["category_id"], amount_minor=6000, date="2026-07-10")
    balance_before = await get_account_balance(client, acct["id"], "2026-07")

    cat_a, cat_b, cat_c = await get_expense_category_ids(client, 3)
    resp = await client.post(
        f"/api/transactions/{tx['id']}/split",
        json={
            "lines": [
                {"category_id": cat_a, "amount_minor": 3800},
                {"category_id": cat_b, "amount_minor": 1250},
                {"category_id": cat_c, "amount_minor": 950},
            ]
        },
    )
    assert resp.status_code == 201, resp.text
    rows = resp.json()
    assert len(rows) == 3
    assert {r["split_group_id"] for r in rows} == {tx["id"]}
    assert sum(r["amount_minor"] for r in rows) == 6000
    # Line 1 reuses the original row.
    assert any(r["id"] == tx["id"] for r in rows)

    balance_after = await get_account_balance(client, acct["id"], "2026-07")
    assert balance_after == balance_before


async def test_split_attributes_to_all_categories_in_report(client: AsyncTestClient) -> None:
    acct = await make_account(client)
    cat = await get_first_expense_category(client)
    tx = await make_transaction(client, acct["id"], cat["category_id"], amount_minor=6000, date="2026-07-10")
    cat_a, cat_b, cat_c = await get_expense_category_ids(client, 3)
    resp = await client.post(
        f"/api/transactions/{tx['id']}/split",
        json={
            "lines": [
                {"category_id": cat_a, "amount_minor": 3800},
                {"category_id": cat_b, "amount_minor": 1250},
                {"category_id": cat_c, "amount_minor": 950},
            ]
        },
    )
    assert resp.status_code == 201, resp.text

    report_resp = await client.get("/api/reports/categories", params={"month": "2026-07", "kind": "expense"})
    assert report_resp.status_code == 200
    totals: dict[int, int] = {}
    for group in report_resp.json()["groups"]:
        for c in group["categories"]:
            totals[c["category_id"]] = totals.get(c["category_id"], 0) + c["total_eur_minor"]
    assert totals.get(cat_a) == 3800
    assert totals.get(cat_b) == 1250
    assert totals.get(cat_c) == 950


async def test_split_rejects_sum_mismatch(client: AsyncTestClient) -> None:
    acct = await make_account(client)
    cat = await get_first_expense_category(client)
    tx = await make_transaction(client, acct["id"], cat["category_id"], amount_minor=6000)
    cat_a, cat_b = await get_expense_category_ids(client, 2)
    resp = await client.post(
        f"/api/transactions/{tx['id']}/split",
        json={
            "lines": [
                {"category_id": cat_a, "amount_minor": 3000},
                {"category_id": cat_b, "amount_minor": 2000},
            ]
        },
    )
    assert resp.status_code == 400


async def test_split_rejects_zero_amount_line(client: AsyncTestClient) -> None:
    acct = await make_account(client)
    cat = await get_first_expense_category(client)
    tx = await make_transaction(client, acct["id"], cat["category_id"], amount_minor=6000)
    cat_a, cat_b = await get_expense_category_ids(client, 2)
    resp = await client.post(
        f"/api/transactions/{tx['id']}/split",
        json={
            "lines": [
                {"category_id": cat_a, "amount_minor": 6000},
                {"category_id": cat_b, "amount_minor": 0},
            ]
        },
    )
    assert resp.status_code == 400


async def test_split_rejects_negative_amount_line(client: AsyncTestClient) -> None:
    acct = await make_account(client)
    cat = await get_first_expense_category(client)
    tx = await make_transaction(client, acct["id"], cat["category_id"], amount_minor=6000)
    cat_a, cat_b = await get_expense_category_ids(client, 2)
    resp = await client.post(
        f"/api/transactions/{tx['id']}/split",
        json={
            "lines": [
                {"category_id": cat_a, "amount_minor": 7000},
                {"category_id": cat_b, "amount_minor": -1000},
            ]
        },
    )
    assert resp.status_code == 400


async def test_split_rejects_single_line(client: AsyncTestClient) -> None:
    acct = await make_account(client)
    cat = await get_first_expense_category(client)
    tx = await make_transaction(client, acct["id"], cat["category_id"], amount_minor=6000)
    resp = await client.post(
        f"/api/transactions/{tx['id']}/split",
        json={"lines": [{"category_id": cat["category_id"], "amount_minor": 6000}]},
    )
    assert resp.status_code == 400


async def test_split_rejects_mixed_kind_categories(client: AsyncTestClient) -> None:
    acct = await make_account(client)
    expense_cat = await get_first_expense_category(client)
    income_cat = await get_first_income_category(client)
    tx = await make_transaction(client, acct["id"], expense_cat["category_id"], amount_minor=6000)
    resp = await client.post(
        f"/api/transactions/{tx['id']}/split",
        json={
            "lines": [
                {"category_id": expense_cat["category_id"], "amount_minor": 3000},
                {"category_id": income_cat["category_id"], "amount_minor": 3000},
            ]
        },
    )
    assert resp.status_code == 400


async def test_split_rejects_kind_mismatch_with_transaction(client: AsyncTestClient) -> None:
    """Lines are internally consistent (all income) but disagree with the expense tx being split."""
    acct = await make_account(client)
    expense_cat = await get_first_expense_category(client)
    tx = await make_transaction(client, acct["id"], expense_cat["category_id"], amount_minor=6000)

    groups = (await client.get("/api/categories")).json()
    income_groups = [g for g in groups if g["kind"] == "income"]
    assert len(income_groups) >= 2, "seed data must provide at least 2 income groups for this test"
    cat1 = await client.post("/api/categories", json={"group_id": income_groups[0]["id"], "name": "Income A"})
    cat2 = await client.post("/api/categories", json={"group_id": income_groups[1]["id"], "name": "Income B"})
    assert cat1.status_code == 201 and cat2.status_code == 201

    resp = await client.post(
        f"/api/transactions/{tx['id']}/split",
        json={
            "lines": [
                {"category_id": cat1.json()["id"], "amount_minor": 3000},
                {"category_id": cat2.json()["id"], "amount_minor": 3000},
            ]
        },
    )
    assert resp.status_code == 400


async def test_split_rejects_already_split_row(client: AsyncTestClient) -> None:
    acct = await make_account(client)
    cat = await get_first_expense_category(client)
    tx = await make_transaction(client, acct["id"], cat["category_id"], amount_minor=6000)
    cat_a, cat_b = await get_expense_category_ids(client, 2)
    first_split = await client.post(
        f"/api/transactions/{tx['id']}/split",
        json={
            "lines": [
                {"category_id": cat_a, "amount_minor": 3000},
                {"category_id": cat_b, "amount_minor": 3000},
            ]
        },
    )
    assert first_split.status_code == 201
    already_split_row = first_split.json()[0]

    resp = await client.post(
        f"/api/transactions/{already_split_row['id']}/split",
        json={
            "lines": [
                {"category_id": cat_a, "amount_minor": 1500},
                {"category_id": cat_b, "amount_minor": 1500},
            ]
        },
    )
    assert resp.status_code == 400


async def test_split_idor_other_household_transaction(make_client: MakeClient) -> None:
    owner_a = await make_client("a@example.com")
    owner_b = await make_client("b@example.com")
    acct_a = await make_account(owner_a)
    cat_a = await get_first_expense_category(owner_a)
    tx_a = await make_transaction(owner_a, acct_a["id"], cat_a["category_id"], amount_minor=6000)
    cat_b1, cat_b2 = await get_expense_category_ids(owner_b, 2)

    resp = await owner_b.post(
        f"/api/transactions/{tx_a['id']}/split",
        json={
            "lines": [
                {"category_id": cat_b1, "amount_minor": 3000},
                {"category_id": cat_b2, "amount_minor": 3000},
            ]
        },
    )
    assert resp.status_code == 404


async def test_create_split_transaction_from_scratch(client: AsyncTestClient) -> None:
    acct = await make_account(client, opening_balance_minor=1000_00)
    balance_before = await get_account_balance(client, acct["id"], "2026-07")
    cat_a, cat_b, cat_c = await get_expense_category_ids(client, 3)

    resp = await client.post(
        "/api/transactions/splits",
        json={
            "account_id": acct["id"],
            "date": "2026-07-10",
            "payee": "EDEKA",
            "lines": [
                {"category_id": cat_a, "amount_minor": 3800},
                {"category_id": cat_b, "amount_minor": 1250},
                {"category_id": cat_c, "amount_minor": 950},
            ],
        },
    )
    assert resp.status_code == 201, resp.text
    rows = resp.json()
    assert len(rows) == 3
    group_ids = {r["split_group_id"] for r in rows}
    assert len(group_ids) == 1
    assert all(r["payee"] == "EDEKA" for r in rows)
    assert sum(r["amount_minor"] for r in rows) == 6000

    balance_after = await get_account_balance(client, acct["id"], "2026-07")
    assert balance_after == balance_before - 6000


async def test_create_split_transaction_idor_account(make_client: MakeClient) -> None:
    owner_a = await make_client("a@example.com")
    owner_b = await make_client("b@example.com")
    acct_a = await make_account(owner_a)
    cat_b1, cat_b2 = await get_expense_category_ids(owner_b, 2)

    resp = await owner_b.post(
        "/api/transactions/splits",
        json={
            "account_id": acct_a["id"],  # B trying to post to A's account
            "date": "2026-07-10",
            "lines": [
                {"category_id": cat_b1, "amount_minor": 3000},
                {"category_id": cat_b2, "amount_minor": 3000},
            ],
        },
    )
    assert resp.status_code == 404


async def test_delete_split_group_restores_balance(client: AsyncTestClient) -> None:
    acct = await make_account(client, opening_balance_minor=1000_00)
    balance_before = await get_account_balance(client, acct["id"], "2026-07")
    cat_a, cat_b = await get_expense_category_ids(client, 2)

    resp = await client.post(
        "/api/transactions/splits",
        json={
            "account_id": acct["id"],
            "date": "2026-07-10",
            "lines": [
                {"category_id": cat_a, "amount_minor": 3000},
                {"category_id": cat_b, "amount_minor": 3000},
            ],
        },
    )
    assert resp.status_code == 201
    rows = resp.json()
    group_id = rows[0]["split_group_id"]

    del_resp = await client.delete(f"/api/transactions/splits/{group_id}")
    assert del_resp.status_code == 204

    balance_after = await get_account_balance(client, acct["id"], "2026-07")
    assert balance_after == balance_before

    ledger_resp = await client.get("/api/ledger", params={"month": "2026-07"})
    remaining_ids = {e["id"] for e in ledger_resp.json() if e["type"] == "transaction"}
    assert remaining_ids.isdisjoint({r["id"] for r in rows})


async def test_delete_split_group_not_found(client: AsyncTestClient) -> None:
    resp = await client.delete("/api/transactions/splits/999999")
    assert resp.status_code == 404


async def test_delete_split_group_idor(make_client: MakeClient) -> None:
    owner_a = await make_client("a@example.com")
    owner_b = await make_client("b@example.com")
    acct_a = await make_account(owner_a)
    cat_a1, cat_a2 = await get_expense_category_ids(owner_a, 2)

    resp = await owner_a.post(
        "/api/transactions/splits",
        json={
            "account_id": acct_a["id"],
            "date": "2026-07-10",
            "lines": [
                {"category_id": cat_a1, "amount_minor": 3000},
                {"category_id": cat_a2, "amount_minor": 3000},
            ],
        },
    )
    assert resp.status_code == 201
    group_id = resp.json()[0]["split_group_id"]

    del_resp = await owner_b.delete(f"/api/transactions/splits/{group_id}")
    assert del_resp.status_code == 404


# ---------------------------------------------------------------------------
# Payee suggestions
# ---------------------------------------------------------------------------


async def test_payees_ranks_more_frequent_merchant_first(client: AsyncTestClient) -> None:
    acct = await make_account(client)
    cat = await get_first_expense_category(client)
    await make_transaction(client, acct["id"], cat["category_id"], payee="EDEKA", date="2026-07-01")
    await make_transaction(client, acct["id"], cat["category_id"], payee="EDEKA", date="2026-07-05")
    await make_transaction(client, acct["id"], cat["category_id"], payee="REWE", date="2026-07-03")

    resp = await client.get("/api/transactions/payees")
    assert resp.status_code == 200
    payees = resp.json()
    names = [p["name"] for p in payees]
    assert names.index("EDEKA") < names.index("REWE")

    edeka = next(p for p in payees if p["name"] == "EDEKA")
    assert edeka["count"] == 2
    assert edeka["last_used"] == "2026-07-05"

    rewe = next(p for p in payees if p["name"] == "REWE")
    assert rewe["count"] == 1


async def test_payees_top_category_id_is_most_used(client: AsyncTestClient) -> None:
    acct = await make_account(client)
    cat_a, cat_b = await get_expense_category_ids(client, 2)
    await make_transaction(client, acct["id"], cat_a, payee="EDEKA", date="2026-07-01")
    await make_transaction(client, acct["id"], cat_a, payee="EDEKA", date="2026-07-02")
    await make_transaction(client, acct["id"], cat_b, payee="EDEKA", date="2026-07-03")

    resp = await client.get("/api/transactions/payees")
    assert resp.status_code == 200
    edeka = next(p for p in resp.json() if p["name"] == "EDEKA")
    assert edeka["count"] == 3
    assert edeka["top_category_id"] == cat_a


async def test_payees_excludes_null_and_empty(client: AsyncTestClient) -> None:
    acct = await make_account(client)
    cat = await get_first_expense_category(client)
    await make_transaction(client, acct["id"], cat["category_id"], date="2026-07-01")  # payee is None
    await make_transaction(client, acct["id"], cat["category_id"], payee="", date="2026-07-02")
    await make_transaction(client, acct["id"], cat["category_id"], payee="EDEKA", date="2026-07-03")

    resp = await client.get("/api/transactions/payees")
    assert resp.status_code == 200
    names = [p["name"] for p in resp.json()]
    assert names == ["EDEKA"]


async def test_payees_never_leaks_other_household_merchants(make_client: MakeClient) -> None:
    owner_a = await make_client("a@example.com")
    owner_b = await make_client("b@example.com")
    acct_a = await make_account(owner_a)
    cat_a = await get_first_expense_category(owner_a)
    await make_transaction(
        owner_a, acct_a["id"], cat_a["category_id"], payee="A-ONLY-MERCHANT", date="2026-07-01"
    )

    acct_b = await make_account(owner_b)
    cat_b = await get_first_expense_category(owner_b)
    await make_transaction(owner_b, acct_b["id"], cat_b["category_id"], payee="B-MERCHANT", date="2026-07-01")

    resp = await owner_b.get("/api/transactions/payees")
    assert resp.status_code == 200
    names = [p["name"] for p in resp.json()]
    assert names == ["B-MERCHANT"]
