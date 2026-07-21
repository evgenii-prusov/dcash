from __future__ import annotations

from datetime import UTC, date, datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Declarative base for all DCash models.

    Every money amount is an integer in minor units next to a 3-letter currency code
    (docs/spec.md §3) — never floats.
    """


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)  # stored lowercased
    password_hash: Mapped[str | None] = mapped_column(String(255))  # NULL for OAuth-only accounts
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))


class OAuthAccount(Base):
    __tablename__ = "oauth_accounts"
    __table_args__ = (UniqueConstraint("provider", "provider_account_id", name="uq_oauth_provider_account"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(20))  # "google" | "github"
    provider_account_id: Mapped[str] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))


class Household(Base):
    __tablename__ = "households"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))


class HouseholdMember(Base):
    __tablename__ = "household_members"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    household_id: Mapped[int] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(20))  # "owner" | "member"
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))


class HouseholdInvite(Base):
    __tablename__ = "household_invites"

    id: Mapped[int] = mapped_column(primary_key=True)
    household_id: Mapped[int] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(64), unique=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), default=None)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)


# ---------------------------------------------------------------------------
# E3: Core Ledger
# ---------------------------------------------------------------------------


class Currency(Base):
    __tablename__ = "currencies"

    code: Mapped[str] = mapped_column(String(3), primary_key=True)  # EUR, USD, RUB
    decimals: Mapped[int]  # 2 for all current currencies
    symbol: Mapped[str] = mapped_column(String(10))  # €, $, ₽


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    household_id: Mapped[int] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    type: Mapped[str] = mapped_column(String(20))  # savings|cash|card
    currency: Mapped[str] = mapped_column(String(3))  # 3-letter code
    opening_balance_minor: Mapped[int] = mapped_column(default=0)
    archived: Mapped[bool] = mapped_column(default=False)
    sort_order: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))


class CategoryGroup(Base):
    __tablename__ = "category_groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    household_id: Mapped[int] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(20))  # expense|income
    sort_order: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    household_id: Mapped[int] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"), index=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("category_groups.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    archived: Mapped[bool] = mapped_column(default=False)
    sort_order: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    household_id: Mapped[int] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"), index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="RESTRICT"), index=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id", ondelete="RESTRICT"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # expense|income — server-derived from category group
    amount_minor: Mapped[int]  # always > 0; sign is implicit in kind
    currency: Mapped[str] = mapped_column(String(3))  # copied from account at creation
    date: Mapped[date]
    payee: Mapped[str | None] = mapped_column(String(200))
    note: Mapped[str | None] = mapped_column(String(500))
    # Set on every row produced by a split; equals the id of the first row in the
    # group. NULL for ordinary transactions. Presentation metadata only —
    # aggregations never filter on it.
    split_group_id: Mapped[int | None] = mapped_column(index=True, default=None)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))


class Transfer(Base):
    __tablename__ = "transfers"

    id: Mapped[int] = mapped_column(primary_key=True)
    household_id: Mapped[int] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"), index=True)
    from_account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="RESTRICT"), index=True)
    to_account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="RESTRICT"), index=True)
    from_amount_minor: Mapped[int]  # > 0; deducted from from_account
    to_amount_minor: Mapped[int]  # > 0; added to to_account
    date: Mapped[date]
    note: Mapped[str | None] = mapped_column(String(500))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))


# ---------------------------------------------------------------------------
# E4: FX Rates
# ---------------------------------------------------------------------------


class Rate(Base):
    __tablename__ = "rates"

    date: Mapped[date] = mapped_column(primary_key=True)
    currency: Mapped[str] = mapped_column(String(3), primary_key=True)
    rate_to_eur: Mapped[str] = mapped_column(String(32))  # TEXT representation of Decimal
    source: Mapped[str] = mapped_column(String(10))  # "auto" | "manual"
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC)
    )
