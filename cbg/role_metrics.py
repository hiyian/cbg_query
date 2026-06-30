from __future__ import annotations

from typing import Any

from .key_items import count_key_items_from_equips
from .sale_status import format_sale_time, sale_status_label

SHENDOUDOU_GOLD = 30_000
BAOSHICHUI_GOLD = 25_000
JINLIULU_GOLD = 100
JINLIULU_MIN_COUNT = 99


def gold_wan(role: dict[str, Any]) -> float:
    return float(role.get("金币") or 0) / 10_000


def gold_ratio(role: dict[str, Any]) -> float | None:
    price = float(role.get("price") or 0)
    if not price:
        return None
    return gold_wan(role) / price


def key_item_counts(role: dict[str, Any]) -> dict[str, int]:
    return count_key_items_from_equips(role.get("equips") or [])


def estimated_material_gold(role: dict[str, Any], items: dict[str, int] | None = None) -> int:
    """物资估算金币数：金柳露始终按数量×100 计入。"""
    counts = items if items is not None else key_item_counts(role)
    gold = int(role.get("金币") or 0)
    return (
        gold
        + counts.get("shendoudou", 0) * SHENDOUDOU_GOLD
        + counts.get("baoshichui", 0) * BAOSHICHUI_GOLD
        + counts.get("jinliulu", 0) * JINLIULU_GOLD
    )


def material_value(role: dict[str, Any], items: dict[str, int] | None = None) -> int:
    """物资比分子：金柳露仅当数量≥99 时计入。"""
    counts = items if items is not None else key_item_counts(role)
    gold = int(role.get("金币") or 0)
    jinliulu = counts.get("jinliulu", 0)
    jll_part = jinliulu * JINLIULU_GOLD if jinliulu >= JINLIULU_MIN_COUNT else 0
    return (
        gold
        + counts.get("shendoudou", 0) * SHENDOUDOU_GOLD
        + counts.get("baoshichui", 0) * BAOSHICHUI_GOLD
        + jll_part
    )


def material_ratio(role: dict[str, Any], items: dict[str, int] | None = None) -> float | None:
    price = float(role.get("price") or 0)
    if not price:
        return None
    return material_value(role, items) / price / 10_000


def enrich_role(role: dict[str, Any]) -> dict[str, Any]:
    items = key_item_counts(role)
    role = dict(role)
    role["_key_items"] = items
    role["gold_ratio"] = gold_ratio(role)
    role["material_gold"] = estimated_material_gold(role, items)
    role["material_ratio"] = material_ratio(role, items)
    status = role.get("sale_status")
    if status:
        role.setdefault("sale_status_label", sale_status_label(status))
    role["sale_time_text"] = format_sale_time(
        sale_status=role.get("sale_status"),
        selling_time=role.get("selling_time"),
    )
    return role
