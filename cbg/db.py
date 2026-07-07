from __future__ import annotations

import json
import os
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .role_metrics import (
    enrich_role,
    estimated_material_gold,
    gold_ratio,
    gold_wan,
    key_item_counts,
    material_ratio,
)
from .sale_status import sale_status_label

ROLE_DETAIL_KEYS = frozenset(
    {
        "ordersn",
        "serverid",
        "server_name",
        "area_name",
        "role_name",
        "school",
        "level",
        "price",
        "金币",
        "冻结金币",
        "sale_status",
        "sale_status_label",
        "selling_time",
        "pass_fair_show",
        "create_time",
        "sale_time_text",
    }
)


def get_database_url(*, prefer_non_pooling: bool = False) -> str:
    if prefer_non_pooling:
        url = os.environ.get("POSTGRES_URL_NON_POOLING")
        if url:
            return url
    for key in ("POSTGRES_URL", "DATABASE_URL"):
        url = os.environ.get(key)
        if url:
            return url
    raise RuntimeError(
        "未找到 Postgres 连接串。请在 Vercel 绑定 Postgres，或设置 POSTGRES_URL 环境变量。"
    )


@contextmanager
def db_conn(*, prefer_non_pooling: bool = False) -> Iterator[psycopg.Connection]:
    conn = psycopg.connect(
        get_database_url(prefer_non_pooling=prefer_non_pooling),
        row_factory=dict_row,
    )
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _json_load(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        return json.loads(value)
    return value


def _role_payload_detail(role: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in role.items() if k not in ROLE_DETAIL_KEYS}


def upsert_server(conn: psycopg.Connection, server: dict[str, Any]) -> int:
    now = _utc_now()
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO servers (server_key, serverid, server_name, area_name, gold_min_wan, synced_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (server_key) DO UPDATE SET
              serverid = EXCLUDED.serverid,
              server_name = EXCLUDED.server_name,
              area_name = EXCLUDED.area_name,
              gold_min_wan = EXCLUDED.gold_min_wan,
              synced_at = EXCLUDED.synced_at
            RETURNING id
            """,
            (
                server["key"],
                server.get("serverid"),
                server.get("server_name") or server["key"],
                server.get("area_name") or "",
                server.get("gold_min_wan"),
                now,
            ),
        )
        row = cur.fetchone()
        if not row:
            raise RuntimeError(f"无法写入服务器记录: {server['key']}")
        return int(row["id"])


def upsert_role(conn: psycopg.Connection, server_id: int, role: dict[str, Any]) -> None:
    now = _utc_now()
    detail = _role_payload_detail(role)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO roles (
              server_id, ordersn, area_name, server_name, role_name, school, level,
              price, gold, frozen_gold_wan, sale_status, selling_time, payload, synced_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (server_id, ordersn) DO UPDATE SET
              area_name = EXCLUDED.area_name,
              server_name = EXCLUDED.server_name,
              role_name = EXCLUDED.role_name,
              school = EXCLUDED.school,
              level = EXCLUDED.level,
              price = EXCLUDED.price,
              gold = EXCLUDED.gold,
              frozen_gold_wan = EXCLUDED.frozen_gold_wan,
              sale_status = EXCLUDED.sale_status,
              selling_time = EXCLUDED.selling_time,
              payload = EXCLUDED.payload,
              synced_at = EXCLUDED.synced_at
            """,
            (
                server_id,
                role.get("ordersn"),
                role.get("area_name") or "",
                role.get("server_name") or "",
                role.get("role_name") or "",
                role.get("school") or "",
                role.get("level"),
                role.get("price"),
                role.get("金币"),
                role.get("冻结金币"),
                role.get("sale_status"),
                role.get("selling_time"),
                Jsonb(detail),
                now,
            ),
        )


def fetch_servers(conn: psycopg.Connection) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT server_key AS key, serverid, server_name, area_name, gold_min_wan, synced_at
            FROM servers
            ORDER BY server_name
            """
        )
        return list(cur.fetchall())


def fetch_meta() -> dict[str, Any]:
    with db_conn() as conn:
        servers = fetch_servers(conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT school
                FROM roles
                WHERE school IS NOT NULL AND school != ''
                ORDER BY school
                """
            )
            schools = [row["school"] for row in cur.fetchall()]
    areas = sorted({s["area_name"] for s in servers if s.get("area_name")})
    return {
        "areas": areas,
        "schools": schools,
        "servers": [
            {
                "key": s["key"],
                "serverid": s["serverid"],
                "server_name": s["server_name"],
                "area_name": s["area_name"],
            }
            for s in servers
        ],
    }


def _row_to_role(row: dict[str, Any]) -> dict[str, Any]:
    payload = _json_load(row["payload"]) or {}
    sale_status = row.get("sale_status") or payload.get("sale_status")
    selling_time = row.get("selling_time")
    if selling_time is None:
        selling_time = payload.get("selling_time")
    return {
        "ordersn": row["ordersn"],
        "server_name": row["server_name"],
        "area_name": row["area_name"],
        "role_name": row["role_name"],
        "school": row["school"],
        "level": row["level"],
        "price": float(row["price"]) if row["price"] is not None else None,
        **payload,
        "sale_status": sale_status,
        "sale_status_label": payload.get("sale_status_label") or sale_status_label(sale_status),
        "selling_time": selling_time,
        "金币": row["gold"],
        "冻结金币": row["frozen_gold_wan"],
        "_server_key": row["server_key"],
    }


def _match_role_filters(
    role: dict[str, Any],
    *,
    gold_min_wan: float | None,
    ratio_min: float | None,
    has_shendoudou: bool,
    has_baoshichui: bool,
    sale_statuses: list[str] | None = None,
) -> bool:
    if sale_statuses:
        status = role.get("sale_status")
        if status not in sale_statuses:
            return False
    if gold_min_wan is not None and gold_wan(role) < gold_min_wan:
        return False
    if ratio_min is not None:
        ratio = gold_ratio(role)
        if ratio is None or ratio < ratio_min:
            return False
    items = key_item_counts(role)
    if has_shendoudou and items.get("shendoudou", 0) <= 0:
        return False
    if has_baoshichui and items.get("baoshichui", 0) <= 0:
        return False
    return True


def _sort_roles(roles: list[dict[str, Any]], sort: str, sort_dir: str) -> list[dict[str, Any]]:
    descending = sort_dir.lower() != "asc"
    item_sort_keys = {"shendoudou", "baoshichui", "jinliulu", "jinghua", "wuse_shi"}

    def sort_value(role: dict[str, Any]) -> float:
        items = role.get("_key_items") or key_item_counts(role)
        if sort == "material_gold":
            return float(role.get("material_gold") or estimated_material_gold(role, items))
        if sort == "material_ratio":
            return material_ratio(role, items) or -1.0
        if sort == "gold_ratio":
            return gold_ratio(role) or -1.0
        if sort == "price":
            return float(role.get("price") or 0)
        if sort == "gold":
            return gold_wan(role)
        if sort == "freeze":
            value = role.get("冻结金币")
            return float(value) if value is not None else -1.0
        if sort == "level":
            return float(role.get("level") or 0)
        if sort == "xianyu":
            return float(role.get("仙玉") or 0)
        if sort == "pet_slot":
            value = role.get("宠物格子数")
            return float(value) if value is not None else -1.0
        if sort in item_sort_keys:
            return float(items.get(sort, 0))
        return material_ratio(role, items) or -1.0

    return sorted(
        roles,
        key=lambda role: (sort_value(role), role.get("role_name") or ""),
        reverse=descending,
    )


def query_roles(
    *,
    server_keys: list[str],
    page: int = 1,
    page_size: int = 50,
    sort: str = "material_ratio",
    sort_dir: str = "desc",
    gold_min_wan: float | None = None,
    role_name: str | None = None,
    school: str | None = None,
    price_min: float | None = None,
    price_max: float | None = None,
    ratio_min: float | None = None,
    has_shendoudou: bool = False,
    has_baoshichui: bool = False,
    sale_statuses: list[str] | None = None,
) -> dict[str, Any]:
    if not server_keys:
        raise ValueError("server_keys 不能为空")

    page = max(page, 1)
    page_size = max(min(page_size, 200), 1)
    placeholders = ", ".join(["%s"] * len(server_keys))
    conditions = [f"s.server_key IN ({placeholders})"]
    params: list[Any] = list(server_keys)

    if role_name:
        conditions.append("r.role_name ILIKE %s")
        params.append(f"%{role_name}%")
    if school:
        conditions.append("r.school = %s")
        params.append(school)
    if price_min is not None:
        conditions.append("r.price >= %s")
        params.append(price_min)
    if price_max is not None:
        conditions.append("r.price <= %s")
        params.append(price_max)
    if gold_min_wan is not None:
        conditions.append("r.gold >= %s")
        params.append(int(gold_min_wan * 10_000))
    if sale_statuses:
        status_placeholders = ", ".join(["%s"] * len(sale_statuses))
        conditions.append(f"r.sale_status IN ({status_placeholders})")
        params.extend(sale_statuses)

    where = " AND ".join(conditions)

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                  s.server_key,
                  s.server_name AS server_area_name,
                  s.area_name AS server_area,
                  r.ordersn,
                  r.area_name,
                  r.server_name,
                  r.role_name,
                  r.school,
                  r.level,
                  r.price,
                  r.gold,
                  r.frozen_gold_wan,
                  r.sale_status,
                  r.selling_time,
                  r.payload,
                  r.synced_at
                FROM roles r
                JOIN servers s ON s.id = r.server_id
                WHERE {where}
                ORDER BY r.synced_at DESC
                """,
                params,
            )
            rows = cur.fetchall()

    roles: list[dict[str, Any]] = []
    detail_count = 0
    latest: datetime | None = None
    for row in rows:
        role = enrich_role(_row_to_role(row))
        if not _match_role_filters(
            role,
            gold_min_wan=gold_min_wan,
            ratio_min=ratio_min,
            has_shendoudou=has_shendoudou,
            has_baoshichui=has_baoshichui,
            sale_statuses=sale_statuses,
        ):
            continue
        roles.append(role)
        detail_count += len(role.get("equips") or []) + len(role.get("summons") or [])
        synced_at = row["synced_at"]
        if synced_at and (latest is None or synced_at > latest):
            latest = synced_at

    sorted_roles = _sort_roles(roles, sort, sort_dir)
    total = len(sorted_roles)
    start = (page - 1) * page_size
    page_roles = sorted_roles[start : start + page_size]

    updated_at = latest.isoformat() if latest else datetime.now(timezone.utc).isoformat()
    return {
        "updated_at": updated_at,
        "server_keys": server_keys,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max((total + page_size - 1) // page_size, 1),
        "sort": sort,
        "sort_dir": sort_dir,
        "total_details": detail_count,
        "roles": page_roles,
    }


def fetch_roles(*, server_key: str | None = None) -> dict[str, Any]:
    with db_conn() as conn:
        servers = fetch_servers(conn)
        params: list[Any] = []
        where = ""
        if server_key:
            where = "WHERE s.server_key = %s"
            params.append(server_key)

        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                  s.server_key,
                  s.server_name AS server_area_name,
                  s.area_name AS server_area,
                  r.ordersn,
                  r.area_name,
                  r.server_name,
                  r.role_name,
                  r.school,
                  r.level,
                  r.price,
                  r.gold,
                  r.frozen_gold_wan,
                  r.payload,
                  r.synced_at
                FROM roles r
                JOIN servers s ON s.id = r.server_id
                {where}
                ORDER BY r.synced_at DESC, r.price ASC
                """,
                params,
            )
            rows = cur.fetchall()

    roles: list[dict[str, Any]] = []
    detail_count = 0
    latest: datetime | None = None
    for row in rows:
        payload = _json_load(row["payload"]) or {}
        role = {
            "ordersn": row["ordersn"],
            "server_name": row["server_name"],
            "area_name": row["area_name"],
            "role_name": row["role_name"],
            "school": row["school"],
            "level": row["level"],
            "price": float(row["price"]) if row["price"] is not None else None,
            **payload,
            "金币": row["gold"],
            "冻结金币": row["frozen_gold_wan"],
            "_server_key": row["server_key"],
        }
        roles.append(role)
        detail_count += len(role.get("equips") or []) + len(role.get("summons") or [])
        synced_at = row["synced_at"]
        if synced_at and (latest is None or synced_at > latest):
            latest = synced_at

    updated_at = latest.isoformat() if latest else datetime.now(timezone.utc).isoformat()
    return {
        "updated_at": updated_at,
        "total_roles": len(roles),
        "total_details": detail_count,
        "servers": [
            {
                "key": s["key"],
                "serverid": s["serverid"],
                "server_name": s["server_name"],
                "area_name": s["area_name"],
                "gold_min_wan": s["gold_min_wan"],
            }
            for s in servers
        ],
        "roles": roles,
    }
