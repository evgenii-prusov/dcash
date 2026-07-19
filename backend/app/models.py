from __future__ import annotations

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Declarative base for all DCash models.

    Tables arrive with the auth/households and core-ledger epics; every money
    amount is an integer in minor units next to a 3-letter currency code
    (docs/spec.md §3) — never floats.
    """
