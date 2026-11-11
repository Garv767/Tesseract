"""Shared Neon PostgreSQL client for Raspberry Pi dispenser scripts.

Reads DATABASE_URL from medicine/.env (or repo-root .env) using Python's
standard library—no python-dotenv required. Uses psycopg or psycopg2 when
installed (e.g. `sudo apt install python3-psycopg2` on Raspberry Pi 2), and
falls back to Neon's HTTPS /sql endpoint via stdlib urllib.request when no
Postgres driver is installed.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from typing import Any, Optional
from urllib.parse import urlparse


def _load_env_files() -> None:
    """Populate os.environ from medicine/.env and repo-root .env without external deps."""
    med_dir = os.path.dirname(os.path.abspath(__file__))
    repo_dir = os.path.dirname(med_dir)
    for env_path in (os.path.join(med_dir, ".env"), os.path.join(repo_dir, ".env")):
        if not os.path.isfile(env_path):
            continue
        try:
            with open(env_path, "r", encoding="utf-8") as fh:
                for raw_line in fh:
                    line = raw_line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    if line.startswith("export "):
                        line = line[7:].strip()
                    key, val = line.split("=", 1)
                    key = key.strip()
                    val = val.strip()
                    if len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"'):
                        val = val[1:-1]
                    if key:
                        os.environ.setdefault(key, val)
        except OSError as exc:
            print(f"[WARN] Could not read {env_path}: {exc}")


def _sanitize_url(raw: str) -> str:
    val = raw.strip()
    if len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"'):
        val = val[1:-1].strip()
    return val


_load_env_files()
DATABASE_URL: str = _sanitize_url(os.getenv("DATABASE_URL", ""))

_psycopg = None
_psycopg2 = None
try:
    import psycopg as _psycopg  # type: ignore[import-not-found]
except ImportError:
    try:
        import psycopg2 as _psycopg2  # type: ignore[import-not-found]
    except ImportError:
        pass


def _detect_backend() -> Optional[str]:
    if not DATABASE_URL:
        return None
    if _psycopg is not None:
        return "psycopg"
    if _psycopg2 is not None:
        return "psycopg2"
    parsed = urlparse(DATABASE_URL)
    if parsed.scheme in ("postgres", "postgresql") and parsed.hostname:
        return "neon_http"
    return None


BACKEND: Optional[str] = _detect_backend()
_NEON_HTTP_ENDPOINT: str = (
    f"https://{urlparse(DATABASE_URL).hostname}/sql" if DATABASE_URL and urlparse(DATABASE_URL).hostname else ""
)


def is_configured() -> bool:
    return BACKEND is not None


def _to_dollar_placeholders(query: str) -> str:
    idx = 0

    def _repl(_match: re.Match[str]) -> str:
        nonlocal idx
        idx += 1
        return f"${idx}"

    return re.sub(r"%s", _repl, query)


def execute(query: str, params: tuple[Any, ...] = (), fetch: bool = False) -> list[dict[str, Any]]:
    """Run a parameterized SQL query against Neon using the active backend."""
    if BACKEND is None:
        raise RuntimeError("DATABASE_URL is not configured")

    if BACKEND == "psycopg":
        assert _psycopg is not None
        with _psycopg.connect(DATABASE_URL, connect_timeout=5) as conn:
            with conn.cursor() as cur:
                cur.execute(query, params)
                if not fetch or cur.description is None:
                    return []
                cols = [d[0] for d in cur.description]
                return [dict(zip(cols, row)) for row in cur.fetchall()]

    if BACKEND == "psycopg2":
        assert _psycopg2 is not None
        conn = _psycopg2.connect(DATABASE_URL, connect_timeout=5)
        try:
            with conn:
                with conn.cursor() as cur:
                    cur.execute(query, params)
                    if not fetch or cur.description is None:
                        return []
                    cols = [d[0] for d in cur.description]
                    return [dict(zip(cols, row)) for row in cur.fetchall()]
        finally:
            conn.close()

    # Pure-stdlib HTTPS fallback via Neon's /sql endpoint (zero external packages)
    http_query = _to_dollar_placeholders(query)
    body = json.dumps({"query": http_query, "params": list(params)}).encode("utf-8")
    req = urllib.request.Request(
        _NEON_HTTP_ENDPOINT,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Neon-Connection-String": DATABASE_URL,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
            return list(payload.get("rows", [])) if fetch else []
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Neon HTTP {exc.code}: {err_body}") from exc


def check_connection() -> bool:
    """Verify Neon connectivity at startup; never raises."""
    if BACKEND is None:
        print("[WARN] DATABASE_URL not set — running offline")
        return False
    try:
        execute("SELECT 1", fetch=True)
        print(f"[SETUP] Neon connected ({BACKEND})")
        return True
    except Exception as exc:
        print(f"[WARN] Neon unreachable at startup ({BACKEND}): {exc}")
        return False


def insert_medicine_log(
    event_type: str,
    message: str,
    distance: Optional[float] = None,
    timestamp: Optional[str] = None,
) -> None:
    if BACKEND is None:
        return
    try:
        execute(
            """
            INSERT INTO medicine_logs (event_type, message, distance, "timestamp")
            VALUES (%s, %s, %s, COALESCE(%s::timestamptz, NOW()))
            """,
            (event_type, message, distance, timestamp),
        )
    except Exception as exc:
        print(f"[WARN] DB insert failed (medicine_logs): {exc}")


def update_dispenser_status(status: str, last_updated: Optional[str] = None) -> None:
    if BACKEND is None:
        return
    try:
        execute(
            """
            INSERT INTO dispenser_status (id, status, last_updated)
            VALUES (1, %s, COALESCE(%s::timestamptz, NOW()))
            ON CONFLICT (id) DO UPDATE
            SET status = EXCLUDED.status,
                last_updated = EXCLUDED.last_updated
            """,
            (status, last_updated),
        )
    except Exception as exc:
        print(f"[WARN] DB status update failed: {exc}")


def insert_dispenser_event(fingerprint_id: int) -> None:
    if BACKEND is None:
        return
    try:
        execute(
            "INSERT INTO dispenser_events (fingerprint_id) VALUES (%s)",
            (int(fingerprint_id),),
        )
    except Exception as exc:
        print(f"[WARN] Fingerprint event insert failed: {exc}")


def get_patient_by_fingerprint(fp_id: int) -> Optional[dict[str, Any]]:
    if BACKEND is None:
        return None
    rows = execute(
        """
        SELECT id, name
        FROM users
        WHERE fingerprint_id = %s AND role = 'PATIENT'
        LIMIT 1
        """,
        (int(fp_id),),
        fetch=True,
    )
    return rows[0] if rows else None


def get_medication_plans(patient_id: str) -> list[dict[str, Any]]:
    if BACKEND is None:
        return []
    return execute(
        """
        SELECT chamber_id, morning_timing, afternoon_timing, evening_timing
        FROM medication_plans
        WHERE patient_id = %s::uuid
        ORDER BY chamber_id
        """,
        (str(patient_id),),
        fetch=True,
    )


def insert_weight_log(payload: dict[str, Any]) -> None:
    if BACKEND is None:
        print("[OFFLINE] Skipping insert -> weight_logs")
        return
    try:
        execute(
            """
            INSERT INTO weight_logs (
                patient_id, chamber_id, weight_grams, snapshot_type,
                timing_period, timing_slot, fingerprint_id
            ) VALUES (%s::uuid, %s, %s, %s, %s, %s, %s)
            """,
            (
                payload.get("patient_id"),
                payload.get("chamber_id"),
                payload.get("weight_grams"),
                payload.get("snapshot_type"),
                payload.get("timing_period"),
                payload.get("timing_slot"),
                payload.get("fingerprint_id"),
            ),
        )
    except Exception as exc:
        print(f"[WARN] DB insert failed (weight_logs): {exc}")


def insert_consumption_log(payload: dict[str, Any]) -> None:
    if BACKEND is None:
        print("[OFFLINE] Skipping insert -> consumption_logs")
        return
    try:
        execute(
            """
            INSERT INTO consumption_logs (
                patient_id, chamber_id, pre_weight_grams, post_weight_grams,
                consumed_grams, status, timing_period, timing_slot, fingerprint_id
            ) VALUES (%s::uuid, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                payload.get("patient_id"),
                payload.get("chamber_id"),
                payload.get("pre_weight_grams"),
                payload.get("post_weight_grams"),
                payload.get("consumed_grams"),
                payload.get("status"),
                payload.get("timing_period"),
                payload.get("timing_slot"),
                payload.get("fingerprint_id"),
            ),
        )
    except Exception as exc:
        print(f"[WARN] DB insert failed (consumption_logs): {exc}")
