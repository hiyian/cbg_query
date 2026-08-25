from __future__ import annotations

import json
from pathlib import Path
from typing import Any

KEY_ITEM_RULES: list[dict[str, Any]] = [
    {"key": "shendoudou", "label": "神兜兜", "exact": ["神兜兜"]},
    {"key": "baoshichui", "label": "宝石锤", "contains": "宝石锤"},
    {"key": "jinliulu", "label": "金柳露", "exact": ["金柳露"]},
    # 法宝精华：名称以「·精华」结尾（如 飞剑·精华）
    {"key": "jinghua", "label": "法宝精华", "suffix": "·精华"},
    {
        "key": "wuse_shi",
        "label": "四色石",
        "exact": ["朱雀石", "青龙石", "白虎石", "玄武石"],
    },
]


FABAO_ESSENCE_SUFFIX = "·精华"
_fabao_base_names: set[str] | None = None


def _load_fabao_base_names() -> set[str]:
    global _fabao_base_names
    if _fabao_base_names is not None:
        return _fabao_base_names
    names: set[str] = set()
    path = Path(__file__).resolve().parents[1] / "data" / "type_names.json"
    if path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        for entry in data.values():
            if isinstance(entry, dict) and entry.get("category") == "法宝":
                names.add(str(entry["name"]))
    _fabao_base_names = names
    return _fabao_base_names


def is_fabao_essence_warehouse_item(name: str, eq_type: str | None = None) -> bool:
    """仓库物品中名称形如「{法宝名}·精华」的法宝精华。"""
    if (eq_type or "") != "仓库物品":
        return False
    name = (name or "").strip()
    if not name.endswith(FABAO_ESSENCE_SUFFIX) or "礼包" in name:
        return False
    base = name[: -len(FABAO_ESSENCE_SUFFIX)]
    fabao_names = _load_fabao_base_names()
    if fabao_names:
        return base in fabao_names
    return bool(base)


def count_fabao_essence_from_equips(equips: list[dict[str, Any]]) -> int:
    total = 0
    for eq in equips:
        if not is_fabao_essence_warehouse_item(eq.get("name") or "", eq.get("type")):
            continue
        try:
            amount = int(eq.get("amount") or 1)
        except (TypeError, ValueError):
            amount = 1
        total += max(amount, 1)
    return total


def match_key_item(name: str, rule: dict[str, Any]) -> bool:
    name = (name or "").strip()
    if not name:
        return False
    exact = rule.get("exact")
    if exact and name in exact:
        return True
    keyword = rule.get("contains")
    if keyword and keyword in name:
        return True
    suffix = rule.get("suffix")
    if suffix and name.endswith(suffix):
        return True
    return False


def empty_key_item_counts() -> dict[str, int]:
    return {rule["key"]: 0 for rule in KEY_ITEM_RULES}


def _add_item_count(
    counts: dict[str, int],
    name: str,
    amount: int,
) -> None:
    if amount < 1:
        amount = 1
    for rule in KEY_ITEM_RULES:
        if match_key_item(name, rule):
            counts[rule["key"]] += amount


def count_key_items_from_details(details: list[dict[str, Any]]) -> dict[str, int]:
    """从明细行统计重点物品（仓库/背包/装备类，不含召唤灵）。"""
    counts = empty_key_item_counts()
    summon_types = {"召唤灵", "仓库召唤灵", "子女", "无明细"}
    for d in details:
        if d.get("明细类型") in summon_types:
            continue
        name = d.get("名称") or ""
        try:
            amount = int(d.get("数量") or 1)
        except (TypeError, ValueError):
            amount = 1
        _add_item_count(counts, name, amount)
    return counts


def count_key_items_from_equips(equips: list[dict[str, Any]]) -> dict[str, int]:
    counts = empty_key_item_counts()
    for eq in equips:
        name = eq.get("name") or ""
        try:
            amount = int(eq.get("amount") or 1)
        except (TypeError, ValueError):
            amount = 1
        _add_item_count(counts, name, amount)
    return counts
