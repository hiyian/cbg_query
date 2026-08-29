from __future__ import annotations

from datetime import datetime
from typing import Any

from .key_items import count_fabao_essence_from_equips, count_key_items_from_equips
from .sale_status import format_sale_time, resolve_live_sale_status, sale_status_label

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


YI = 100_000_000
EXP_69_TO_89 = 18.38 * YI
EXP_69_TO_115 = 87.49 * YI
EXP_89_TO_115 = 69.11 * YI

SHIKONG_OPEN_DATES = {
    "英雄本色": "2024-06-21",
    "传说": "2024-07-12",
    "一心一意": "2024-07-26",
    "友情岁月": "2024-08-02",
    "我们结婚吧": "2024-08-09",
    "出神入化": "2024-08-16",
    "侠客行": "2024-08-23",
    "同桌的你": "2024-08-30",
    "晚安大小姐": "2024-09-06",
    "家好月圆": "2024-09-13",
    "秋风满月": "2024-09-20",
    "华夏": "2024-09-27",
    "诗和远方": "2024-10-04",
    "佳人有约": "2024-11-01",
    "＃２４": "2024-11-22",
}


def current_exp(role: dict[str, Any]) -> float | None:
    value = role.get("当前经验")
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def total_exp(role: dict[str, Any]) -> float | None:
    value = role.get("总经验")
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def usable_exp(role: dict[str, Any]) -> float | None:
    total = total_exp(role)
    current = current_exp(role)
    if total is None or current is None:
        return None
    return max(0.0, total - current)


def show_boost_115(role: dict[str, Any], *, today: str | None = None) -> bool:
    if (role.get("area_name") or "") != "时空区":
        return True
    opened = SHIKONG_OPEN_DATES.get(role.get("server_name") or "")
    if not opened:
        return False
    if today is None:
        today = datetime.now().date().isoformat()
    cutoff_y, cutoff_m, cutoff_d = (int(x) for x in today.split("-"))
    cutoff_y -= 2
    cutoff = f"{cutoff_y:04d}-{cutoff_m:02d}-{cutoff_d:02d}"
    return opened <= cutoff


def boost_89_pct(role: dict[str, Any]) -> float:
    have = usable_exp(role) or 0
    if float(role.get("level") or 0) >= 89:
        return 1.0
    return min(1.0, have / EXP_69_TO_89) if EXP_69_TO_89 else 0.0


def boost_115_pct(role: dict[str, Any]) -> float:
    if not show_boost_115(role):
        return -1.0
    have = usable_exp(role) or 0
    level = float(role.get("level") or 0)
    if level >= 115:
        return 1.0
    need = EXP_89_TO_115 if level >= 89 else EXP_69_TO_115
    return min(1.0, have / need) if need else 0.0


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
    status = resolve_live_sale_status(role.get("sale_status"), role.get("selling_time"))
    role["sale_status"] = status
    if status:
        role["sale_status_label"] = sale_status_label(status)
    role["sale_time_text"] = format_sale_time(
        sale_status=status,
        selling_time=role.get("selling_time"),
    )
    return role
