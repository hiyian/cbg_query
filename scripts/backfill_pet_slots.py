#!/usr/bin/env python3
"""回填 Postgres roles.payload 中的宠物格子数（summons.raw.iMaxBSlot → 宠物格子数）。

数据来源（可组合）：
  1. mhcbg/output/ 下已抓取的详情 JSON（默认 ../output）
  2. --fetch：对仍缺失格子的角色调 CBG 详情 API 拉取

示例：
  python scripts/backfill_pet_slots.py --dry-run
  python scripts/backfill_pet_slots.py -o ../output
  python scripts/backfill_pet_slots.py --fetch -c ../config.demo.json --limit 50
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
MHCBG_ROOT = ROOT.parent
sys.path.insert(0, str(ROOT))

from cbg.db import backfill_pet_slots_in_pg, db_conn, patch_role_pet_slot_in_pg
from cbg.role_metrics import pet_slot_count, pet_slot_from_profile


def _load_profiles_from_dir(output_dir: Path) -> list[dict[str, Any]]:
    profiles: list[dict[str, Any]] = []
    for path in sorted(output_dir.glob("*.json")):
        if path.name == "index.json":
            continue
        profiles.append(json.loads(path.read_text(encoding="utf-8")))
    return profiles


def _server_key_for_dir(server_dir: Path) -> str:
    index = server_dir / "index.json"
    if index.exists():
        server = (json.loads(index.read_text(encoding="utf-8")).get("server") or {})
        if server.get("key"):
            return str(server["key"])
    return server_dir.name


def load_slot_map_from_output_root(root: Path) -> dict[tuple[str, str], int]:
    slot_map: dict[tuple[str, str], int] = {}

    def ingest_dir(server_dir: Path) -> None:
        if not server_dir.is_dir():
            return
        server_key = _server_key_for_dir(server_dir)
        for profile in _load_profiles_from_dir(server_dir):
            ordersn = (profile.get("meta") or {}).get("ordersn")
            slot = pet_slot_from_profile(profile)
            if ordersn and slot is not None:
                slot_map[(server_key, ordersn)] = slot

    if not root.exists():
        return slot_map

    has_profiles = (root / "index.json").exists() or any(
        p.suffix == ".json" and p.name != "index.json" for p in root.iterdir()
    )
    if has_profiles:
        ingest_dir(root)
    else:
        for sub in sorted(root.iterdir()):
            ingest_dir(sub)
    return slot_map


def list_missing_roles(*, limit: int | None = None) -> list[dict[str, Any]]:
    with db_conn(prefer_non_pooling=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT r.ordersn, s.server_key, s.serverid, r.payload
                FROM roles r
                JOIN servers s ON s.id = r.server_id
                ORDER BY r.id
                """
            )
            rows = cur.fetchall()

    missing: list[dict[str, Any]] = []
    for row in rows:
        payload = row["payload"]
        if isinstance(payload, str):
            payload = json.loads(payload)
        if pet_slot_count(payload or {}) is not None:
            continue
        missing.append(row)
        if limit is not None and len(missing) >= limit:
            break
    return missing


def fetch_and_patch(
    *,
    config_path: Path,
    delay: float,
    dry_run: bool,
    limit: int | None,
) -> dict[str, int]:
    sys.path.insert(0, str(MHCBG_ROOT))
    from cbg import CbgApiError, SessionTimeoutError, fetch_role_profile
    from cbg.client import CbgClient

    queue = list_missing_roles(limit=limit)
    stats = {"queued": len(queue), "fetched": 0, "updated": 0, "failed": 0}

    if not queue:
        return stats

    try:
        with CbgClient(str(config_path)) as client:
            for row in queue:
                server_key = row["server_key"]
                ordersn = row["ordersn"]
                serverid = row["serverid"]
                try:
                    profile = fetch_role_profile(
                        client,
                        serverid=serverid,
                        ordersn=ordersn,
                    )
                    stats["fetched"] += 1
                except (CbgApiError, SessionTimeoutError) as exc:
                    print(f"  跳过 {server_key} {ordersn}: {exc}", flush=True)
                    stats["failed"] += 1
                    if delay > 0:
                        time.sleep(delay)
                    continue

                slot = pet_slot_from_profile(profile)
                if slot is None:
                    print(f"  无格子数 {server_key} {ordersn}", flush=True)
                    stats["failed"] += 1
                elif patch_role_pet_slot_in_pg(
                    server_key=server_key,
                    ordersn=ordersn,
                    pet_slots=slot,
                    dry_run=dry_run,
                ):
                    stats["updated"] += 1
                    print(f"  {'[dry-run] ' if dry_run else ''}回填 {server_key} {ordersn} → {slot}", flush=True)
                else:
                    stats["failed"] += 1

                if delay > 0:
                    time.sleep(delay)
    except SessionTimeoutError as exc:
        raise SystemExit(f"登录失效: {exc}") from exc

    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description="回填 Postgres 宠物格子数")
    parser.add_argument(
        "-o",
        "--output-root",
        type=Path,
        default=MHCBG_ROOT / "output",
        help="mhcbg 详情 JSON 根目录（默认 ../output）",
    )
    parser.add_argument(
        "--fetch",
        action="store_true",
        help="对仍缺失格子的角色调用 CBG API 拉取详情",
    )
    parser.add_argument(
        "-c",
        "--config",
        type=Path,
        default=MHCBG_ROOT / "config.json",
        help="CBG Cookie 配置（--fetch 时使用）",
    )
    parser.add_argument("--delay", type=float, default=1.0, help="API 请求间隔秒数")
    parser.add_argument("--limit", type=int, help="--fetch 时最多处理条数")
    parser.add_argument("--dry-run", action="store_true", help="只统计，不写入")
    parser.add_argument(
        "--force",
        action="store_true",
        help="覆盖已有宠物格子数（默认只补缺失）",
    )
    args = parser.parse_args()

    slot_map = load_slot_map_from_output_root(args.output_root)
    print(f"本地详情映射: {len(slot_map)} 条（来自 {args.output_root}）")

    if slot_map:
        stats = backfill_pet_slots_in_pg(
            slot_map,
            dry_run=args.dry_run,
            only_missing=not args.force,
        )
        print(
            f"本地回填: 扫描 {stats['scanned']}，更新 {stats['updated']}，"
            f"已有跳过 {stats['skipped_has']}，无来源 {stats['no_source']}"
            + ("（dry-run）" if args.dry_run else "")
        )

    if args.fetch:
        fetch_stats = fetch_and_patch(
            config_path=args.config,
            delay=args.delay,
            dry_run=args.dry_run,
            limit=args.limit,
        )
        print(
            f"API 回填: 待补 {fetch_stats['queued']}，拉取 {fetch_stats['fetched']}，"
            f"写入 {fetch_stats['updated']}，失败 {fetch_stats['failed']}"
            + ("（dry-run）" if args.dry_run else "")
        )


if __name__ == "__main__":
    main()
