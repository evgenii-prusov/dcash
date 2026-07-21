"""Transaction splits: nullable split_group_id on transactions.

Revision ID: 0005
Revises: 0004
Create Date: 2026-07-21
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("transactions", sa.Column("split_group_id", sa.Integer(), nullable=True))
    op.create_index("ix_transactions_split_group_id", "transactions", ["split_group_id"])


def downgrade() -> None:
    op.drop_index("ix_transactions_split_group_id", table_name="transactions")
    op.drop_column("transactions", "split_group_id")
