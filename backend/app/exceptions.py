from __future__ import annotations


class OAuthError(Exception):
    """Carries one of the §2.7 error codes; caught at the callback handler boundary."""

    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)
