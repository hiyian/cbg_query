#!/usr/bin/env python3
"""从 mhcbg 项目的 MySQL 同步数据到 Vercel Postgres。在本地运行，不部署到 Vercel。"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
MHCBG_ROOT = ROOT.parent
sys.path.insert(0, str(ROOT))

try:
    import pymysql
    from pymysql.cursors import DictCursor
except ImportError as exc:
    raise SystemExit("请先安装: pip install pymysql") from exc

from cbg.db import db_conn, upsert_role, upsert_server


def load_mysql_config(path: Path | None) -> dict[str, Any]:
    env_map = {
        "host": os.environ.get("MYSQL_HOST"),
        "port": os.environ.get("MYSQL_PORT"),
        "user": os.environ.get("MYSQL_USER"),
        "password": os.environ.get("MYSQL_PASSWORD"),
        "database": os.environ.get("MYSQL_DATABASE"),
    }
    if all(env_map.values()):
        return {
            "host": env_map["host"],
            "port": int(env_map["port"]),
            "user": env_map["user"],
            "password": env_map["password"],
            "database": env_map["database"],
        }

    config_path = path or MHCBG_ROOT / "mysql.config.json"
    if not config_path.exists():
        raise FileNotFoundError(
            f"未找到 MySQL 配置: {config_path}\n"
            "请在上级 mhcbg 目录配置 mysql.config.json，或设置 MYSQL_* 环境变量"
        )
    cfg = json.loads(config_path.read_text(encoding="utf-8"))
    return {
        "host": cfg.get("host", "127.0.0.1"),
        "port": int(cfg.get("port", 3306)),
        "user": cfg["user"],
        "password": cfg["password"],
        "database": cfg.get("database", "mhcbg"),
    }


def _json_load(value: Any) -> Any:
    if value is None or isinstance(value, (dict, list)):
        return value
    return json.loads(value)


def fetch_mysql_rows(cfg: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    conn = pymysql.connect(
        host=cfg["host"],
        port=cfg["port"],
        user=cfg["user"],
        password=cfg["password"],
        database=cfg["database"],
        charset="utf8mb4",
        cursorclass=DictCursor,
    )
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT server_key AS `key`, serverid, server_name, area_name, gold_min_wan
                FROM servers
                ORDER BY id
                """
            )
            servers = list(cur.fetchall())
            cur.execute(
                """
                SELECT
                  s.server_key,
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
                  r.payload
                FROM roles r
                JOIN servers s ON s.id = r.server_id
                ORDER BY r.id
                """
            )
            roles = list(cur.fetchall())
    finally:
        conn.close()
    return servers, roles


def mysql_role_to_upsert(row: dict[str, Any]) -> dict[str, Any]:
    payload = _json_load(row["payload"]) or {}
    return {
        "ordersn": row["ordersn"],
        "area_name": row["area_name"],
        "server_name": row["server_name"],
        "role_name": row["role_name"],
        "school": row["school"],
        "level": row["level"],
        "price": float(row["price"]) if row["price"] is not None else None,
        "金币": row["gold"],
        "冻结金币": row["frozen_gold_wan"],
        "sale_status": row.get("sale_status"),
        "selling_time": row.get("selling_time"),
        **payload,
    }


def sync(*, mysql_config: Path | None, dry_run: bool) -> None:
    cfg = load_mysql_config(mysql_config)
    servers, roles = fetch_mysql_rows(cfg)
    print(f"MySQL: {len(servers)} 个服务器, {len(roles)} 条角色")

    if dry_run:
        return

    server_ids: dict[str, int] = {}
    with db_conn(prefer_non_pooling=True) as pg:
        for server in servers:
            server_ids[server["key"]] = upsert_server(pg, server)
        for row in roles:
            server_key = row["server_key"]
            server_id = server_ids.get(server_key)
            if server_id is None:
                raise RuntimeError(f"缺少服务器记录: {server_key}")
            upsert_role(pg, server_id, mysql_role_to_upsert(row))

    print(f"已同步到 Postgres: {len(servers)} 服务器, {len(roles)} 角色")


def main() -> None:
    parser = argparse.ArgumentParser(description="MySQL → Vercel Postgres 数据同步")
    parser.add_argument(
        "--mysql-config",
        type=Path,
        help="MySQL 配置文件路径（默认 ../mysql.config.json）",
    )
    parser.add_argument("--dry-run", action="store_true", help="只统计，不写入")
    args = parser.parse_args()
    sync(mysql_config=args.mysql_config, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
