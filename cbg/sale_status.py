from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

SALE_FAIR_SHOW = "fair_show"
SALE_ONSALE = "onsale"
SALE_REVIEWING = "reviewing"

SALE_LABELS = {
    SALE_FAIR_SHOW: "公示期",
    SALE_ONSALE: "上架中",
    SALE_REVIEWING: "审核中",
}


def extract_sale_info(raw: dict[str, Any] | None) -> dict[str, Any]:
    """从列表项或 equip 详情提取上架状态。"""
    if not raw:
        return {}

    reviewing = raw.get("onsale_reviewing_remain_seconds")
    if reviewing not in (None, "", 0, "0"):
        return {
            "sale_status": SALE_REVIEWING,
            "sale_status_label": SALE_LABELS[SALE_REVIEWING],
            "selling_time": _to_int(raw.get("selling_time")),
            "pass_fair_show": _to_int(raw.get("pass_fair_show")),
            "create_time": _to_int(raw.get("create_time")),
        }

    pass_fair = raw.get("pass_fair_show")
    if pass_fair is not None and int(pass_fair) == 0:
        status = SALE_FAIR_SHOW
    else:
        status = SALE_ONSALE

    return {
        "sale_status": status,
        "sale_status_label": SALE_LABELS[status],
        "selling_time": _to_int(raw.get("selling_time")),
        "pass_fair_show": _to_int(pass_fair) if pass_fair is not None else None,
        "create_time": _to_int(raw.get("create_time")),
    }


def sale_status_label(status: str | None) -> str:
    if not status:
        return ""
    return SALE_LABELS.get(status, status)


def format_sale_time(
    *,
    sale_status: str | None,
    selling_time: int | None,
    now: datetime | None = None,
) -> str:
    """格式化列表展示用的时间文案。"""
    if sale_status == SALE_REVIEWING:
        return "审核中"
    if not selling_time:
        return "-"

    ts = int(selling_time)
    if ts > 1_000_000_000_000:
        ts //= 1000

    dt = datetime.fromtimestamp(ts, tz=timezone.utc).astimezone()
    time_text = dt.strftime("%m-%d %H:%M")

    if sale_status == SALE_FAIR_SHOW:
        current = now or datetime.now().astimezone()
        remain = ts - int(current.timestamp())
        if remain > 0:
            return f"{_fmt_remain(remain)}后上架"
        return f"{time_text} 上架"

    if sale_status == SALE_ONSALE:
        return f"{time_text} 上架"

    return time_text


def _fmt_remain(seconds: int) -> str:
    seconds = max(seconds, 0)
    days, rem = divmod(seconds, 86400)
    hours, rem = divmod(rem, 3600)
    minutes, secs = divmod(rem, 60)
    if days:
        return f"{days}天{hours:02d}:{minutes:02d}"
    if hours:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def _to_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
