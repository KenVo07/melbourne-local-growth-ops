"""Small JSON HTTP client using the Python standard library."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from .common import MLGOError


class HTTPError(MLGOError):
    def __init__(self, status: int | None, message: str, payload: Any = None):
        self.status = status
        self.payload = payload
        super().__init__(message)


def request_json_value(
    url: str,
    *,
    method: str = "GET",
    query: dict[str, Any] | None = None,
    body: dict[str, Any] | None = None,
    timeout: float = 60.0,
) -> Any:
    if query:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(
            {k: v for k, v in query.items() if v is not None}
        )
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
            if not raw:
                return {}
            return json.loads(raw)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = raw
        detail = payload.get("detail") if isinstance(payload, dict) else payload
        raise HTTPError(exc.code, f"HTTP {exc.code}: {detail}", payload) from exc
    except urllib.error.URLError as exc:
        raise HTTPError(None, f"connection failed: {exc.reason}") from exc


def request_json(
    url: str,
    *,
    method: str = "GET",
    query: dict[str, Any] | None = None,
    body: dict[str, Any] | None = None,
    timeout: float = 60.0,
) -> dict[str, Any]:
    value = request_json_value(
        url, method=method, query=query, body=body, timeout=timeout
    )
    if not isinstance(value, dict):
        raise HTTPError(None, "expected JSON object response", value)
    return value
