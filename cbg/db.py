from __future__ import annotations

import json
import os
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

_PKG_ROOT = Path(__file__).resolve().parents[1]
_PINYIN_INDEX_PATH = _PKG_ROOT / "data" / "server_pinyin.json"
_pinyin_index_cache: Any = None

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .role_metrics import (
    boost_115_pct,
    boost_89_pct,
    current_exp,
    usable_exp,
    enrich_role,
    estimated_material_gold,
    gold_ratio,
    gold_wan,
    key_item_counts,
    material_ratio,
    pet_slot_count,
)
from .sale_status import resolve_live_sale_status, sale_status_label

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


def _load_pinyin_index() -> dict[str, dict[str, str]]:
    """serverid / server_key -> {pinyin, area_pinyin}"""
    global _pinyin_index_cache
    if _pinyin_index_cache is not None:
        return _pinyin_index_cache
    by_id: dict[str, dict[str, str]] = {}
    by_key: dict[str, dict[str, str]] = {}
    if _PINYIN_INDEX_PATH.exists():
        try:
            rows = json.loads(_PINYIN_INDEX_PATH.read_text(encoding="utf-8"))
            for row in rows:
                info = {
                    "pinyin": row.get("pinyin") or "",
                    "area_pinyin": row.get("area_pinyin") or "",
                }
                sid = row.get("serverid")
                if sid is not None:
                    by_id[str(sid)] = info
                key = row.get("key")
                if key:
                    by_key[str(key)] = info
        except (json.JSONDecodeError, OSError):
            pass
    _pinyin_index_cache = {"by_id": by_id, "by_key": by_key}
    return _pinyin_index_cache


def _attach_server_pinyin(server: dict[str, Any]) -> dict[str, Any]:
    idx = _load_pinyin_index()
    info = idx["by_key"].get(server.get("key") or "") or idx["by_id"].get(
        str(server.get("serverid") or "")
    )
    pinyin = (info or {}).get("pinyin") or server.get("key") or ""
    area_pinyin = (info or {}).get("area_pinyin") or ""
    return {
        **server,
        "pinyin": pinyin,
        "area_pinyin": area_pinyin,
    }


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
        tasks = _fetch_tasks(conn)
    areas = sorted({s["area_name"] for s in servers if s.get("area_name")})
    return {
        "areas": areas,
        "schools": schools,
        "tasks": tasks,
        "servers": [
            _attach_server_pinyin(
                {
                    "key": s["key"],
                    "serverid": s["serverid"],
                    "server_name": s["server_name"],
                    "area_name": s["area_name"],
                }
            )
            for s in servers
        ],
    }


def _fetch_tasks(conn: psycopg.Connection) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              tag->>'task' AS task_key,
              MAX(COALESCE(NULLIF(tag->>'task_label', ''), tag->>'task')) AS task_label,
              COUNT(*) AS cnt
            FROM roles r
            CROSS JOIN LATERAL jsonb_array_elements(r.payload->'crawl_tags') AS tag
            WHERE jsonb_typeof(r.payload->'crawl_tags') = 'array'
              AND COALESCE(tag->>'task', '') != ''
            GROUP BY tag->>'task'
            ORDER BY task_label
            """
        )
        return [
            {
                "key": row["task_key"],
                "label": row["task_label"] or row["task_key"],
                "count": int(row["cnt"]),
            }
            for row in cur.fetchall()
        ]


def _row_to_role(row: dict[str, Any]) -> dict[str, Any]:
    payload = _json_load(row["payload"]) or {}
    column_status = row.get("sale_status")
    sale_status = column_status or payload.get("sale_status")
    # 以 roles 表的 sale_status 列为准（差集标记的 sold 在这里），
    # payload 里的旧 label 可能已过期。
    if column_status:
        status_label = sale_status_label(column_status)
    else:
        status_label = payload.get("sale_status_label") or sale_status_label(sale_status)
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
        "sale_status_label": status_label,
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
    pet_slot_min: int | None = None,
    sale_statuses: list[str] | None = None,
) -> bool:
    if sale_statuses:
        status = resolve_live_sale_status(role.get("sale_status"), role.get("selling_time"))
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
    if pet_slot_min is not None:
        slots = pet_slot_count(role)
        if slots is None or slots <= pet_slot_min:
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
        if sort == "current_exp":
            return current_exp(role) or 0.0
        if sort == "total_exp":
            return float(role.get("总经验") or 0)
        if sort == "usable_exp":
            return usable_exp(role) or 0.0
        if sort == "boost89":
            return boost_89_pct(role)
        if sort == "boost115":
            return boost_115_pct(role)
        if sort == "pet_slot":
            value = pet_slot_count(role)
            return float(value) if value is not None else -1.0
        if sort == "shenshou":
            return float(role.get("神兽数") or 0)
        if sort in item_sort_keys:
            return float(items.get(sort, 0))
        return material_ratio(role, items) or -1.0

    return sorted(
        roles,
        key=lambda role: (sort_value(role), role.get("role_name") or ""),
        reverse=descending,
    )


def _crawl_tag_contains(*items: dict[str, str]) -> tuple[str, list[Any]]:
    """用 GIN 可加速的 @> 过滤 crawl_tags。每个条件是要同时命中的字段。"""
    clauses = []
    params: list[Any] = []
    for item in items:
        clauses.append("r.payload->'crawl_tags' @> %s")
        params.append(Jsonb([item]))
    return "(" + " OR ".join(clauses) + ")", params


def apply_sale_status_by_time(conn: psycopg.Connection) -> int:
    """有 selling_time 的角色：当前时间未到可购买则公示期，到了则上架中。已售/审核中不改。"""
    now_ts = int(datetime.now(timezone.utc).timestamp())
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE roles
            SET sale_status = CASE
                  WHEN (
                    CASE WHEN selling_time > 1000000000000
                         THEN selling_time / 1000 ELSE selling_time END
                  ) > %s THEN 'fair_show'
                  ELSE 'onsale'
                END
            WHERE selling_time IS NOT NULL
              AND sale_status IS DISTINCT FROM 'sold'
              AND sale_status IS DISTINCT FROM 'reviewing'
              AND sale_status IS DISTINCT FROM (
                CASE
                  WHEN (
                    CASE WHEN selling_time > 1000000000000
                         THEN selling_time / 1000 ELSE selling_time END
                  ) > %s THEN 'fair_show'
                  ELSE 'onsale'
                END
              )
            """,
            (now_ts, now_ts),
        )
        return cur.rowcount or 0


def query_roles(
    *,
    server_keys: list[str] | None = None,
    task_keys: list[str] | None = None,
    batch_key: str | None = None,
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
    pet_slot_min: int | None = None,
    sale_statuses: list[str] | None = None,
) -> dict[str, Any]:
    server_keys = [key for key in (server_keys or []) if key]
    task_keys = [key for key in (task_keys or []) if key]
    batch_key = (batch_key or "").strip() or None
    if not server_keys and not task_keys and not batch_key:
        raise ValueError("请至少选择服务器或任务")

    page = max(page, 1)
    page_size = max(min(page_size, 200), 1)
    conditions: list[str] = []
    params: list[Any] = []
    if server_keys:
        placeholders = ", ".join(["%s"] * len(server_keys))
        conditions.append(f"s.server_key IN ({placeholders})")
        params.extend(server_keys)
    if task_keys or batch_key:
        tag_filters: list[dict[str, str]] = []
        if task_keys and batch_key:
            tag_filters.extend({"task": key, "batch": batch_key} for key in task_keys)
        elif task_keys:
            tag_filters.extend({"task": key} for key in task_keys)
        else:
            tag_filters.append({"batch": batch_key})
        clause, tag_params = _crawl_tag_contains(*tag_filters)
        conditions.append(clause)
        params.extend(tag_params)

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
    sql_sale_statuses = list(sale_statuses or [])
    if sale_statuses and ({"fair_show", "onsale"} & set(sale_statuses)):
        sql_sale_statuses = sorted(set(sale_statuses) | {"fair_show", "onsale"})
    if sql_sale_statuses:
        status_placeholders = ", ".join(["%s"] * len(sql_sale_statuses))
        conditions.append(f"r.sale_status IN ({status_placeholders})")
        params.extend(sql_sale_statuses)

    where = " AND ".join(conditions)

    with db_conn() as conn:
        apply_sale_status_by_time(conn)
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
            pet_slot_min=pet_slot_min,
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
        "task_keys": task_keys,
        "batch": batch_key,
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


def backfill_pet_slots_in_pg(
    slot_map: dict[tuple[str, str], int],
    *,
    dry_run: bool = False,
    only_missing: bool = True,
) -> dict[str, int]:
    """用 (server_key, ordersn) → 格子数 映射回填 Postgres roles.payload。"""
    stats = {"scanned": 0, "updated": 0, "skipped_has": 0, "no_source": 0}
    with db_conn(prefer_non_pooling=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT r.id, r.ordersn, s.server_key, r.payload
                FROM roles r
                JOIN servers s ON s.id = r.server_id
                ORDER BY r.id
                """
            )
            rows = cur.fetchall()

        for row in rows:
            stats["scanned"] += 1
            payload = _json_load(row["payload"]) or {}
            if only_missing and pet_slot_count(payload) is not None:
                stats["skipped_has"] += 1
                continue
            slot = slot_map.get((row["server_key"], row["ordersn"]))
            if slot is None:
                stats["no_source"] += 1
                continue
            stats["updated"] += 1
            if dry_run:
                continue
            payload = dict(payload)
            payload["宠物格子数"] = slot
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE roles SET payload = %s WHERE id = %s",
                    (Jsonb(payload), row["id"]),
                )
    return stats


def patch_role_pet_slot_in_pg(
    *,
    server_key: str,
    ordersn: str,
    pet_slots: int,
    dry_run: bool = False,
) -> bool:
    with db_conn(prefer_non_pooling=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT r.id, r.payload
                FROM roles r
                JOIN servers s ON s.id = r.server_id
                WHERE s.server_key = %s AND r.ordersn = %s
                """,
                (server_key, ordersn),
            )
            row = cur.fetchone()
            if not row:
                return False
            if dry_run:
                return True
            payload = dict(_json_load(row["payload"]) or {})
            payload["宠物格子数"] = pet_slots
            cur.execute(
                "UPDATE roles SET payload = %s WHERE id = %s",
                (Jsonb(payload), row["id"]),
            )
    return True
