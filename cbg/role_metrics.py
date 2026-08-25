from __future__ import annotations

from typing import Any

from .key_items import count_fabao_essence_from_equips, count_key_items_from_equips
from .sale_status import format_sale_time, sale_status_label

SHENDOUDOU_GOLD = 30_000
BAOSHICHUI_GOLD = 25_000
JINLIULU_GOLD = 100
JINLIULU_MIN_COUNT = 99
SHENSHOU_GOLD = 3_000_000
FABAO_JINGHUA_GOLD = 9_000
SHENSHOU_LIFE = 999999


def pet_slot_count(role: dict[str, Any]) -> int | None:
    value = role.get("宠物格子数")
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def pet_slot_from_profile(profile: dict[str, Any]) -> int | None:
    """从完整 profile 提取 summons.raw.iMaxBSlot。"""
    slot = ((profile.get("summons") or {}).get("raw") or {}).get("iMaxBSlot")
    if slot is None:
        return None
    try:
        return int(slot)
    except (TypeError, ValueError):
        return None


def shenshou_count(role: dict[str, Any]) -> int:
    """神兽（寿命 999999 的召唤灵）数量。优先取抓取时算好的字段。"""
    value = role.get("神兽数")
    if value is not None:
        try:
            return int(value)
        except (TypeError, ValueError):
            pass
    count = 0
    for pet in role.get("summons") or []:
        life = pet.get("life")
        try:
            if life is not None and int(life) == SHENSHOU_LIFE:
                count += 1
        except (TypeError, ValueError):
            continue
    return count


def gold_wan(role: dict[str, Any]) -> float:
    return float(role.get("金币") or 0) / 10_000


def gold_ratio(role: dict[str, Any]) -> float | None:
    price = float(role.get("price") or 0)
    if not price:
        return None
    return gold_wan(role) / price


def fabao_jinghua_count(role: dict[str, Any]) -> int:
    value = role.get("fabao_jinghua")
    if value is not None:
        try:
            return int(value)
        except (TypeError, ValueError):
            pass
    return count_fabao_essence_from_equips(role.get("equips") or [])


def key_item_counts(role: dict[str, Any]) -> dict[str, int]:
    return count_key_items_from_equips(role.get("equips") or [])


def estimated_material_gold(role: dict[str, Any], items: dict[str, int] | None = None) -> int:
    """物资估算金币数：金柳露始终按数量×100 计入；仓库法宝·精华按×9000。"""
    counts = items if items is not None else key_item_counts(role)
    gold = int(role.get("金币") or 0)
    fabao_jh = fabao_jinghua_count(role)
    return (
        gold
        + counts.get("shendoudou", 0) * SHENDOUDOU_GOLD
        + counts.get("baoshichui", 0) * BAOSHICHUI_GOLD
        + counts.get("jinliulu", 0) * JINLIULU_GOLD
        + fabao_jh * FABAO_JINGHUA_GOLD
        + shenshou_count(role) * SHENSHOU_GOLD
    )


def material_value(role: dict[str, Any], items: dict[str, int] | None = None) -> int:
    """物资比分子：金柳露仅当数量≥99 时计入；仓库法宝·精华始终计入。"""
    counts = items if items is not None else key_item_counts(role)
    gold = int(role.get("金币") or 0)
    jinliulu = counts.get("jinliulu", 0)
    jll_part = jinliulu * JINLIULU_GOLD if jinliulu >= JINLIULU_MIN_COUNT else 0
    fabao_jh = fabao_jinghua_count(role)
    return (
        gold
        + counts.get("shendoudou", 0) * SHENDOUDOU_GOLD
        + counts.get("baoshichui", 0) * BAOSHICHUI_GOLD
        + jll_part
        + fabao_jh * FABAO_JINGHUA_GOLD
        + shenshou_count(role) * SHENSHOU_GOLD
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
    slots = pet_slot_count(role)
    if slots is not None:
        role["宠物格子数"] = slots
    role["神兽数"] = shenshou_count(role)
    role["fabao_jinghua"] = fabao_jinghua_count(role)
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
