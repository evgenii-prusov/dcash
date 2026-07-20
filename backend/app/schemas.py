from __future__ import annotations

from datetime import datetime

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
