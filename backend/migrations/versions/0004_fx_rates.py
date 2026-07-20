"""FX rates table.

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-20
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rates",
        sa.Column("date", sa.Date(), primary_key=True),
        sa.Column("currency", sa.String(3), primary_key=True),
        sa.Column("rate_to_eur", sa.String(32), nullable=False),
        sa.Column("source", sa.String(10), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("rates")
