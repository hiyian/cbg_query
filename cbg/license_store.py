"""卡密 / 机器码 / 埋点 / 反馈 — Postgres 读写。"""

from __future__ import annotations

import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Any

from psycopg.types.json import Jsonb

from .db import db_conn


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _norm_code(code: str) -> str:
    return "".join(str(code or "").upper().split())


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _gen_code(kind: str) -> str:
    alphabet = string.ascii_uppercase + string.digits
    a = "".join(secrets.choice(alphabet) for _ in range(4))
    b = "".join(secrets.choice(alphabet) for _ in range(4))
    prefix = "XM-TEST" if kind == "test" else "XM-PRO"
    return f"{prefix}-{a}-{b}"


def _row_key(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "code": row["code"],
        "kind": row["kind"],
        "status": row["status"],
        "expires_at": _iso(row.get("expires_at")),
        "max_machines": row.get("max_machines"),
        "note": row.get("note") or "",
        "created_at": _iso(row.get("created_at")),
        "created_by": row.get("created_by") or "",
        "machine_count": row.get("machine_count"),
    }


def _effective_status(row: dict[str, Any], now: datetime | None = None) -> str:
    status = row.get("status") or "unused"
    if status == "revoked":
        return "revoked"
    now = now or _now()
    expires = row.get("expires_at")
    if expires is not None:
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires <= now:
            return "expired"
    return status


def create_keys(
    *,
    kind: str,
    count: int = 1,
    days: int | None = None,
    note: str = "",
    created_by: str = "admin",
) -> list[dict[str, Any]]:
    if kind not in ("test", "official"):
        raise ValueError("kind 须为 test 或 official")
    count = max(1, min(int(count), 100))
    if days is None:
        days = 7 if kind == "test" else 30
    days = max(1, int(days))
    expires_at = _now() + timedelta(days=days)
    max_machines = None if kind == "test" else 1

    created: list[dict[str, Any]] = []
    with db_conn(prefer_non_pooling=True) as conn:
        with conn.cursor() as cur:
            for _ in range(count):
                code = _gen_code(kind)
                # 极低概率碰撞时重试
                for _attempt in range(5):
                    cur.execute(
                        """
                        INSERT INTO license_keys
                          (code, kind, status, expires_at, max_machines, note, created_by)
                        VALUES (%s, %s, 'unused', %s, %s, %s, %s)
                        ON CONFLICT (code) DO NOTHING
                        RETURNING id, code, kind, status, expires_at, max_machines, note,
                                  created_at, created_by
                        """,
                        (code, kind, expires_at, max_machines, note or "", created_by),
                    )
                    row = cur.fetchone()
                    if row:
                        created.append(_row_key(row))
                        break
                    code = _gen_code(kind)
                else:
                    raise RuntimeError("生成卡密失败，请重试")
    return created


def list_keys(
    *,
    kind: str | None = None,
    status: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    limit = max(1, min(int(limit), 500))
    clauses: list[str] = []
    params: list[Any] = []
    if kind:
        clauses.append("k.kind = %s")
        params.append(kind)
    if status:
        clauses.append("k.status = %s")
        params.append(status)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    params.append(limit)
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT k.id, k.code, k.kind, k.status, k.expires_at, k.max_machines,
                       k.note, k.created_at, k.created_by,
                       (SELECT COUNT(*) FROM license_machines m WHERE m.key_id = k.id) AS machine_count
                FROM license_keys k
                {where}
                ORDER BY k.created_at DESC
                LIMIT %s
                """,
                params,
            )
            rows = cur.fetchall()
    now = _now()
    out = []
    for row in rows:
        item = _row_key(row)
        item["effective_status"] = _effective_status(row, now)
        out.append(item)
    return out


def get_key(key_id: int) -> dict[str, Any] | None:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, code, kind, status, expires_at, max_machines, note,
                       created_at, created_by, session_token
                FROM license_keys WHERE id = %s
                """,
                (key_id,),
            )
            row = cur.fetchone()
    if not row:
        return None
    item = _row_key(row)
    item["effective_status"] = _effective_status(row)
    return item


def revoke_key(key_id: int) -> dict[str, Any]:
    with db_conn(prefer_non_pooling=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE license_keys SET status = 'revoked'
                WHERE id = %s
                RETURNING id, code, kind, status, expires_at, max_machines, note,
                          created_at, created_by
                """,
                (key_id,),
            )
            row = cur.fetchone()
    if not row:
        raise KeyError(key_id)
    return _row_key(row)


def unbind_machines(key_id: int) -> int:
    with db_conn(prefer_non_pooling=True) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM license_keys WHERE id = %s", (key_id,))
            if not cur.fetchone():
                raise KeyError(key_id)
            cur.execute("DELETE FROM license_machines WHERE key_id = %s", (key_id,))
            deleted = cur.rowcount
            cur.execute(
                """
                UPDATE license_keys
                SET status = CASE WHEN status = 'active' THEN 'unused' ELSE status END,
                    session_token = NULL
                WHERE id = %s
                """,
                (key_id,),
            )
    return int(deleted or 0)


def list_machines(key_id: int) -> list[dict[str, Any]]:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, key_id, machine_id, machine_label,
                       first_seen_at, last_seen_at, activate_count
                FROM license_machines
                WHERE key_id = %s
                ORDER BY last_seen_at DESC
                """,
                (key_id,),
            )
            rows = cur.fetchall()
    return [
        {
            "id": r["id"],
            "key_id": r["key_id"],
            "machine_id": r["machine_id"],
            "machine_label": r.get("machine_label") or "",
            "first_seen_at": _iso(r.get("first_seen_at")),
            "last_seen_at": _iso(r.get("last_seen_at")),
            "activate_count": r.get("activate_count") or 0,
        }
        for r in rows
    ]


def _load_key_by_code_or_token(
    cur, *, code: str | None, session_token: str | None
) -> dict[str, Any] | None:
    if session_token:
        cur.execute(
            """
            SELECT id, code, kind, status, expires_at, max_machines, note,
                   created_at, created_by, session_token
            FROM license_keys WHERE session_token = %s
            """,
            (session_token,),
        )
        row = cur.fetchone()
        if row:
            return row
    if code:
        cur.execute(
            """
            SELECT id, code, kind, status, expires_at, max_machines, note,
                   created_at, created_by, session_token
            FROM license_keys WHERE code = %s
            """,
            (_norm_code(code),),
        )
        return cur.fetchone()
    return None


def activate(
    *,
    code: str,
    machine_id: str,
    machine_label: str = "",
) -> dict[str, Any]:
    machine_id = (machine_id or "").strip()
    if not machine_id:
        raise ValueError("缺少 machine_id")
    code_n = _norm_code(code)
    if not code_n:
        raise ValueError("请输入卡密")

    with db_conn(prefer_non_pooling=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, code, kind, status, expires_at, max_machines, note,
                       created_at, created_by, session_token
                FROM license_keys WHERE code = %s
                FOR UPDATE
                """,
                (code_n,),
            )
            row = cur.fetchone()
            if not row:
                raise LookupError("卡密无效")

            eff = _effective_status(row)
            if eff == "revoked":
                raise PermissionError("卡密已吊销")
            if eff == "expired":
                cur.execute(
                    "UPDATE license_keys SET status = 'expired' WHERE id = %s AND status != 'revoked'",
                    (row["id"],),
                )
                raise PermissionError("卡密已过期")

            # 正式卡：已有其它机器则拒绝
            max_m = row.get("max_machines")
            cur.execute(
                "SELECT machine_id FROM license_machines WHERE key_id = %s",
                (row["id"],),
            )
            existing = [r["machine_id"] for r in cur.fetchall()]
            if max_m is not None and machine_id not in existing and len(existing) >= int(max_m):
                raise PermissionError("该卡密已绑定其它设备，请联系管理员解绑")

            now = _now()
            cur.execute(
                """
                INSERT INTO license_machines
                  (key_id, machine_id, machine_label, first_seen_at, last_seen_at, activate_count)
                VALUES (%s, %s, %s, %s, %s, 1)
                ON CONFLICT (key_id, machine_id) DO UPDATE SET
                  machine_label = CASE
                    WHEN EXCLUDED.machine_label = '' THEN license_machines.machine_label
                    ELSE EXCLUDED.machine_label
                  END,
                  last_seen_at = EXCLUDED.last_seen_at,
                  activate_count = license_machines.activate_count + 1
                """,
                (row["id"], machine_id, machine_label or "", now, now),
            )

            token = row.get("session_token") or secrets.token_hex(24)
            cur.execute(
                """
                UPDATE license_keys
                SET status = 'active', session_token = %s
                WHERE id = %s
                RETURNING id, code, kind, status, expires_at, max_machines, session_token
                """,
                (token, row["id"]),
            )
            updated = cur.fetchone()

    return {
        "ok": True,
        "key_id": updated["id"],
        "code": updated["code"],
        "kind": updated["kind"],
        "status": updated["status"],
        "expires_at": _iso(updated["expires_at"]),
        "session_token": updated["session_token"],
        "machine_id": machine_id,
    }


def verify(
    *,
    machine_id: str,
    code: str | None = None,
    session_token: str | None = None,
) -> dict[str, Any]:
    machine_id = (machine_id or "").strip()
    if not machine_id:
        raise ValueError("缺少 machine_id")
    if not code and not session_token:
        raise ValueError("请提供 code 或 session_token")

    with db_conn(prefer_non_pooling=True) as conn:
        with conn.cursor() as cur:
            row = _load_key_by_code_or_token(cur, code=code, session_token=session_token)
            if not row:
                raise LookupError("授权无效")

            eff = _effective_status(row)
            if eff == "revoked":
                raise PermissionError("卡密已吊销")
            if eff == "expired":
                cur.execute(
                    "UPDATE license_keys SET status = 'expired' WHERE id = %s AND status != 'revoked'",
                    (row["id"],),
                )
                raise PermissionError("卡密已过期")

            max_m = row.get("max_machines")
            cur.execute(
                "SELECT machine_id FROM license_machines WHERE key_id = %s",
                (row["id"],),
            )
            existing = [r["machine_id"] for r in cur.fetchall()]

            if machine_id not in existing:
                if max_m is not None and len(existing) >= int(max_m):
                    raise PermissionError("该卡密已绑定其它设备")
                # 测试卡：校验时也可登记新机器
                now = _now()
                cur.execute(
                    """
                    INSERT INTO license_machines
                      (key_id, machine_id, machine_label, first_seen_at, last_seen_at, activate_count)
                    VALUES (%s, %s, '', %s, %s, 1)
                    ON CONFLICT (key_id, machine_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at
                    """,
                    (row["id"], machine_id, now, now),
                )
            else:
                cur.execute(
                    """
                    UPDATE license_machines SET last_seen_at = %s
                    WHERE key_id = %s AND machine_id = %s
                    """,
                    (_now(), row["id"], machine_id),
                )

            token = row.get("session_token") or secrets.token_hex(24)
            if not row.get("session_token"):
                cur.execute(
                    "UPDATE license_keys SET session_token = %s, status = 'active' WHERE id = %s",
                    (token, row["id"]),
                )
            else:
                token = row["session_token"]
                if row.get("status") == "unused":
                    cur.execute(
                        "UPDATE license_keys SET status = 'active' WHERE id = %s",
                        (row["id"],),
                    )

    return {
        "ok": True,
        "key_id": row["id"],
        "code": row["code"],
        "kind": row["kind"],
        "status": "active",
        "expires_at": _iso(row["expires_at"]),
        "session_token": token,
        "machine_id": machine_id,
    }


def insert_events(events: list[dict[str, Any]]) -> int:
    if not events:
        return 0
    now = _now()
    rows = []
    for ev in events[:200]:
        name = (ev.get("event") or "").strip()
        if not name:
            continue
        occurred = ev.get("occurred_at")
        if isinstance(occurred, str) and occurred:
            try:
                occurred_dt = datetime.fromisoformat(occurred.replace("Z", "+00:00"))
            except ValueError:
                occurred_dt = now
        else:
            occurred_dt = now
        rows.append(
            (
                occurred_dt,
                now,
                (ev.get("machine_id") or "")[:128],
                ev.get("license_key_id"),
                name[:64],
                Jsonb(ev.get("props") or {}),
            )
        )
    if not rows:
        return 0
    with db_conn(prefer_non_pooling=True) as conn:
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO analytics_events
                  (occurred_at, received_at, machine_id, license_key_id, event, props)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                rows,
            )
    return len(rows)


def list_events(
    *,
    event: str | None = None,
    machine_id: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    limit = max(1, min(int(limit), 500))
    clauses: list[str] = []
    params: list[Any] = []
    if event:
        clauses.append("event = %s")
        params.append(event)
    if machine_id:
        clauses.append("machine_id = %s")
        params.append(machine_id)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    params.append(limit)
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT id, occurred_at, received_at, machine_id, license_key_id, event, props
                FROM analytics_events
                {where}
                ORDER BY occurred_at DESC
                LIMIT %s
                """,
                params,
            )
            rows = cur.fetchall()
    return [
        {
            "id": r["id"],
            "occurred_at": _iso(r.get("occurred_at")),
            "received_at": _iso(r.get("received_at")),
            "machine_id": r.get("machine_id") or "",
            "license_key_id": r.get("license_key_id"),
            "event": r["event"],
            "props": r.get("props") or {},
        }
        for r in rows
    ]


def create_feedback(
    *,
    content: str,
    category: str = "other",
    machine_id: str = "",
    license_key_id: int | None = None,
    contact: str = "",
    app_version: str = "",
    os_name: str = "",
) -> dict[str, Any]:
    content = (content or "").strip()
    if not content:
        raise ValueError("请填写反馈内容")
    if category not in ("bug", "feature", "other"):
        category = "other"
    with db_conn(prefer_non_pooling=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO feedbacks
                  (machine_id, license_key_id, category, content, contact, app_version, os)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id, created_at, machine_id, license_key_id, category, content,
                          contact, app_version, os
                """,
                (
                    (machine_id or "")[:128],
                    license_key_id,
                    category,
                    content[:4000],
                    (contact or "")[:256],
                    (app_version or "")[:64],
                    (os_name or "")[:128],
                ),
            )
            row = cur.fetchone()
    return {
        "id": row["id"],
        "created_at": _iso(row.get("created_at")),
        "ok": True,
    }


def list_feedbacks(*, limit: int = 100) -> list[dict[str, Any]]:
    limit = max(1, min(int(limit), 500))
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, created_at, machine_id, license_key_id, category, content,
                       contact, app_version, os
                FROM feedbacks
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (limit,),
            )
            rows = cur.fetchall()
    return [
        {
            "id": r["id"],
            "created_at": _iso(r.get("created_at")),
            "machine_id": r.get("machine_id") or "",
            "license_key_id": r.get("license_key_id"),
            "category": r["category"],
            "content": r["content"],
            "contact": r.get("contact") or "",
            "app_version": r.get("app_version") or "",
            "os": r.get("os") or "",
        }
        for r in rows
    ]
