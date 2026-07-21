from __future__ import annotations

from datetime import date, datetime

import msgspec

UNSET = msgspec.UNSET


class UserOut(msgspec.Struct):
    id: int
    email: str


class SignupPayload(msgspec.Struct):
    email: str
    password: str
    invite_code: str


class LoginPayload(msgspec.Struct):
    email: str
    password: str


class HouseholdOut(msgspec.Struct):
    id: int
    name: str


class MemberOut(msgspec.Struct):
    id: int
    email: str
    role: str
    joined_at: datetime


class InviteOut(msgspec.Struct):
    id: int
    code: str
    expires_at: datetime
    used_at: datetime | None


class InviteCreate(msgspec.Struct):
    pass  # no body needed; household is derived from session


# ---------------------------------------------------------------------------
# E3: Accounts
# ---------------------------------------------------------------------------

ACCOUNT_TYPES = frozenset({"savings", "cash", "card"})


class AccountCreate(msgspec.Struct):
    name: str
    type: str
    currency: str
    opening_balance_minor: int = 0
    sort_order: int = 0


class AccountPatch(msgspec.Struct):
    name: str | msgspec.UnsetType = msgspec.UNSET
    opening_balance_minor: int | msgspec.UnsetType = msgspec.UNSET
    archived: bool | msgspec.UnsetType = msgspec.UNSET
    sort_order: int | msgspec.UnsetType = msgspec.UNSET


class AccountOut(msgspec.Struct):
    id: int
    name: str
    type: str
    currency: str
    opening_balance_minor: int
    balance_minor: int
    balance_eur_minor: int
    archived: bool
    sort_order: int


# ---------------------------------------------------------------------------
# E3: Categories
# ---------------------------------------------------------------------------


class CategoryCreate(msgspec.Struct):
    group_id: int
    name: str
    sort_order: int = 0


class CategoryPatch(msgspec.Struct):
    name: str | msgspec.UnsetType = msgspec.UNSET
    archived: bool | msgspec.UnsetType = msgspec.UNSET
    sort_order: int | msgspec.UnsetType = msgspec.UNSET


class CategoryOut(msgspec.Struct):
    id: int
    name: str
    archived: bool
    sort_order: int


class CategoryGroupCreate(msgspec.Struct):
    name: str
    kind: str  # expense|income
    sort_order: int = 0


class CategoryGroupPatch(msgspec.Struct):
    name: str | msgspec.UnsetType = msgspec.UNSET
    sort_order: int | msgspec.UnsetType = msgspec.UNSET


class CategoryGroupOut(msgspec.Struct):
    id: int
    name: str
    kind: str
    sort_order: int
    categories: list[CategoryOut]


# ---------------------------------------------------------------------------
# E3: Transactions
# ---------------------------------------------------------------------------


class TransactionCreate(msgspec.Struct):
    account_id: int
    category_id: int
    amount_minor: int
    date: date
    payee: str | None = None
    note: str | None = None


class TransactionPatch(msgspec.Struct):
    category_id: int | msgspec.UnsetType = msgspec.UNSET
    amount_minor: int | msgspec.UnsetType = msgspec.UNSET
    date: date | msgspec.UnsetType = msgspec.UNSET
    payee: str | None | msgspec.UnsetType = msgspec.UNSET
    note: str | None | msgspec.UnsetType = msgspec.UNSET


class TransactionOut(msgspec.Struct):
    id: int
    account_id: int
    account_name: str
    category_id: int
    category_name: str
    group_name: str
    kind: str
    amount_minor: int
    amount_eur_minor: int
    currency: str
    date: date
    payee: str | None
    note: str | None
    split_group_id: int | None
    created_at: datetime


# ---------------------------------------------------------------------------
# E7: Transaction splits
# ---------------------------------------------------------------------------


class TransactionSplitLine(msgspec.Struct):
    category_id: int
    amount_minor: int
    note: str | None = None


class TransactionSplitPayload(msgspec.Struct):
    """Body for POST /{tx_id}/split — splits an existing transaction in place."""

    lines: list[TransactionSplitLine]


class TransactionSplitCreate(msgspec.Struct):
    """Body for POST /splits — creates an already-split entry from scratch."""

    account_id: int
    date: date
    lines: list[TransactionSplitLine]
    payee: str | None = None
    note: str | None = None


class PayeeSuggestion(msgspec.Struct):
    """One row of GET /payees — a household's merchant history for autocomplete."""

    name: str
    count: int
    last_used: date
    top_category_id: int | None


# ---------------------------------------------------------------------------
# E3: Transfers
# ---------------------------------------------------------------------------


class TransferCreate(msgspec.Struct):
    from_account_id: int
    to_account_id: int
    from_amount_minor: int
    to_amount_minor: int
    date: date
    note: str | None = None


class TransferPatch(msgspec.Struct):
    from_amount_minor: int | msgspec.UnsetType = msgspec.UNSET
    to_amount_minor: int | msgspec.UnsetType = msgspec.UNSET
    date: date | msgspec.UnsetType = msgspec.UNSET
    note: str | None | msgspec.UnsetType = msgspec.UNSET


class TransferOut(msgspec.Struct):
    id: int
    from_account_id: int
    from_account_name: str
    to_account_id: int
    to_account_name: str
    from_amount_minor: int
    to_amount_minor: int
    from_amount_eur_minor: int
    to_amount_eur_minor: int
    from_currency: str
    to_currency: str
    date: date
    note: str | None
    created_at: datetime


# ---------------------------------------------------------------------------
# E3: Ledger (merged stream)
# ---------------------------------------------------------------------------


class LedgerTransaction(msgspec.Struct):
    type: str  # "transaction"
    id: int
    account_id: int
    account_name: str
    category_id: int
    category_name: str
    group_name: str
    kind: str
    amount_minor: int
    amount_eur_minor: int
    currency: str
    date: date
    payee: str | None
    note: str | None
    split_group_id: int | None
    created_at: datetime


class LedgerTransfer(msgspec.Struct):
    type: str  # "transfer"
    id: int
    from_account_id: int
    from_account_name: str
    to_account_id: int
    to_account_name: str
    from_amount_minor: int
    to_amount_minor: int
    from_amount_eur_minor: int
    to_amount_eur_minor: int
    from_currency: str
    to_currency: str
    date: date
    note: str | None
    created_at: datetime


# ---------------------------------------------------------------------------
# E4: Rates
# ---------------------------------------------------------------------------


class RateOut(msgspec.Struct):
    date: date
    currency: str
    rate_to_eur: str
    source: str


class RateOverridePayload(msgspec.Struct):
    rate_to_eur: str


# ---------------------------------------------------------------------------
# E5: Reports & Dashboard
# ---------------------------------------------------------------------------


class SummaryAccount(msgspec.Struct):
    id: int
    name: str
    type: str
    currency: str
    balance_minor: int
    balance_eur_minor: int


class ReportSummaryOut(msgspec.Struct):
    month: str
    income_eur_minor: int
    expenses_eur_minor: int
    net_eur_minor: int
    accounts: list[SummaryAccount]


class CategoryRollup(msgspec.Struct):
    category_id: int
    category_name: str
    total_eur_minor: int


class GroupRollup(msgspec.Struct):
    group_id: int
    group_name: str
    total_eur_minor: int
    categories: list[CategoryRollup]


class ReportCategoriesOut(msgspec.Struct):
    month: str
    kind: str
    groups: list[GroupRollup]


class NetWorthPoint(msgspec.Struct):
    month: str
    net_worth_eur_minor: int


class ReportNetWorthOut(msgspec.Struct):
    points: list[NetWorthPoint]
