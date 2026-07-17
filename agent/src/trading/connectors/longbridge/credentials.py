"""Atomic Longbridge credential resolution shared by market data and trading."""

from __future__ import annotations

import hmac
import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping

from src.config.paths import get_runtime_root

_FIELDS = ("app_key", "app_secret", "access_token")


@dataclass(frozen=True)
class LongbridgeCredentials:
    app_key: str = field(repr=False)
    app_secret: str = field(repr=False)
    access_token: str = field(repr=False)


@dataclass(frozen=True)
class CredentialResolution:
    credentials: LongbridgeCredentials | None
    source: str | None
    missing_fields: tuple[str, ...]
    conflict_fields: tuple[str, ...]


class LongbridgeCredentialError(RuntimeError):
    def __init__(self, code: str, fields: tuple[str, ...]) -> None:
        self.code = code
        self.fields = fields
        super().__init__(f"{code}: {', '.join(fields)}")


def resolve_longbridge_credentials(runtime_root: Path | None = None) -> CredentialResolution:
    """Select one complete credential source without mixing partial secrets."""
    environment = {
        "app_key": os.getenv("LONGBRIDGE_APP_KEY", "").strip(),
        "app_secret": os.getenv("LONGBRIDGE_APP_SECRET", "").strip(),
        "access_token": os.getenv("LONGBRIDGE_ACCESS_TOKEN", "").strip(),
    }
    root = runtime_root if runtime_root is not None else get_runtime_root()
    runtime, file_state = _runtime_file_values(root / "longbridge.json")
    missing_environment, missing_runtime = _missing(environment), _missing(runtime)
    if 0 < len(missing_environment) < len(_FIELDS):
        return CredentialResolution(None, "environment", missing_environment, ())
    if not missing_environment:
        if not missing_runtime:
            conflicts = tuple(key for key in _FIELDS if not hmac.compare_digest(environment[key], runtime[key]))
            if conflicts:
                return CredentialResolution(None, None, (), conflicts)
        return CredentialResolution(LongbridgeCredentials(**environment), "environment", (), ())
    if 0 < len(missing_runtime) < len(_FIELDS):
        return CredentialResolution(None, "runtime_file", missing_runtime, ())
    if not missing_runtime:
        return CredentialResolution(LongbridgeCredentials(**runtime), "runtime_file", (), ())
    return CredentialResolution(None, "runtime_file" if file_state == "invalid" else None, _FIELDS, ())


def _runtime_file_values(path: Path) -> tuple[dict[str, str], str]:
    empty = {key: "" for key in _FIELDS}
    if not path.exists():
        return empty, "absent"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return empty, "invalid"
    if not isinstance(payload, Mapping):
        return empty, "invalid"
    return {key: str(payload.get(key) or "").strip() for key in _FIELDS}, "valid"


def _missing(values: Mapping[str, str]) -> tuple[str, ...]:
    return tuple(key for key in _FIELDS if not values[key])
