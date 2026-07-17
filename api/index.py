from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import Body, Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from cbg import license_store
from cbg.db import fetch_meta, fetch_roles, query_roles

app = FastAPI(title="MHCBG Query API", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

SORT_FIELDS = {
    "material_ratio",
    "material_gold",
    "gold_ratio",
    "price",
    "gold",
    "freeze",
    "level",
    "xianyu",
    "pet_slot",
    "shenshou",
    "shendoudou",
    "baoshichui",
    "jinliulu",
    "jinghua",
    "wuse_shi",
}

APP_ID = os.environ.get("APP_ID", "xunmi").strip()


def _check_app_id(x_app_id: Annotated[str | None, Header()] = None) -> None:
    expected = APP_ID
    if not expected:
        return
    if (x_app_id or "").strip() != expected:
        raise HTTPException(status_code=403, detail="无效的客户端标识")


def _require_admin(x_admin_token: Annotated[str | None, Header()] = None) -> None:
    token = (os.environ.get("ADMIN_TOKEN") or "").strip()
    if not token:
        raise HTTPException(status_code=503, detail="服务端未配置 ADMIN_TOKEN")
    if (x_admin_token or "").strip() != token:
        raise HTTPException(status_code=401, detail="管理口令错误")


# ---------------- 查询（原有） ----------------

@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/meta")
def meta() -> dict:
    return fetch_meta()


@app.get("/api/roles")
def list_roles(
    server_key: Annotated[
        list[str] | None,
        Query(description="服务器 key，可重复传参多选"),
    ] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
    sort: Annotated[str, Query(description="排序字段")] = "material_ratio",
    sort_dir: Annotated[Literal["asc", "desc"], Query()] = "desc",
    gold_min: Annotated[float | None, Query(description="金币下限（万）")] = None,
    role_name: Annotated[str | None, Query()] = None,
    school: Annotated[str | None, Query()] = None,
    price_min: Annotated[float | None, Query()] = None,
    price_max: Annotated[float | None, Query()] = None,
    ratio_min: Annotated[float | None, Query(description="金币/价格下限")] = None,
    has_shendoudou: Annotated[bool, Query()] = False,
    has_baoshichui: Annotated[bool, Query()] = False,
    sale_status: Annotated[
        list[str] | None,
        Query(description="上架状态：fair_show=公示期, onsale=上架中"),
    ] = None,
    legacy_all: Annotated[
        bool,
        Query(description="兼容旧版：不传 server_key 时返回全部"),
    ] = False,
) -> dict:
    server_keys = [key.strip() for key in (server_key or []) if key and key.strip()]
    if not server_keys:
        if legacy_all:
            return fetch_roles(server_key=None)
        raise HTTPException(status_code=400, detail="请至少选择一个服务器（server_key）")

    if sort not in SORT_FIELDS:
        raise HTTPException(status_code=400, detail=f"不支持的排序字段: {sort}")

    allowed_sale_status = {"fair_show", "onsale", "reviewing", "sold"}
    sale_statuses = [s.strip() for s in (sale_status or []) if s and s.strip()]
    invalid = [s for s in sale_statuses if s not in allowed_sale_status]
    if invalid:
        raise HTTPException(status_code=400, detail=f"不支持的 sale_status: {', '.join(invalid)}")

    return query_roles(
        server_keys=server_keys,
        page=page,
        page_size=page_size,
        sort=sort,
        sort_dir=sort_dir,
        gold_min_wan=gold_min,
        role_name=role_name,
        school=school,
        price_min=price_min,
        price_max=price_max,
        ratio_min=ratio_min,
        has_shendoudou=has_shendoudou,
        has_baoshichui=has_baoshichui,
        sale_statuses=sale_statuses or None,
    )


# ---------------- 卡密（客户端） ----------------

@app.post("/api/license/activate", dependencies=[Depends(_check_app_id)])
def license_activate(payload: Annotated[dict[str, Any], Body(...)]) -> dict:
    try:
        return license_store.activate(
            code=str(payload.get("code") or ""),
            machine_id=str(payload.get("machine_id") or ""),
            machine_label=str(payload.get("machine_label") or ""),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@app.post("/api/license/verify", dependencies=[Depends(_check_app_id)])
def license_verify(payload: Annotated[dict[str, Any], Body(...)]) -> dict:
    try:
        return license_store.verify(
            machine_id=str(payload.get("machine_id") or ""),
            code=(str(payload["code"]) if payload.get("code") else None),
            session_token=(
                str(payload["session_token"]) if payload.get("session_token") else None
            ),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@app.post("/api/events", dependencies=[Depends(_check_app_id)])
def post_events(payload: Annotated[dict[str, Any], Body(...)]) -> dict:
    events = payload.get("events") or []
    if not isinstance(events, list):
        raise HTTPException(status_code=400, detail="events 须为数组")
    n = license_store.insert_events(events)
    return {"ok": True, "accepted": n}


@app.post("/api/feedback", dependencies=[Depends(_check_app_id)])
def post_feedback(payload: Annotated[dict[str, Any], Body(...)]) -> dict:
    try:
        return license_store.create_feedback(
            content=str(payload.get("content") or ""),
            category=str(payload.get("category") or "other"),
            machine_id=str(payload.get("machine_id") or ""),
            license_key_id=payload.get("license_key_id"),
            contact=str(payload.get("contact") or ""),
            app_version=str(payload.get("app_version") or ""),
            os_name=str(payload.get("os") or ""),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ---------------- 管理后台 ----------------

@app.post("/api/admin/keys", dependencies=[Depends(_require_admin)])
def admin_create_keys(payload: Annotated[dict[str, Any], Body(...)]) -> dict:
    try:
        keys = license_store.create_keys(
            kind=str(payload.get("kind") or "test"),
            count=int(payload.get("count") or 1),
            days=payload.get("days"),
            note=str(payload.get("note") or ""),
            created_by=str(payload.get("created_by") or "admin"),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"keys": keys}


@app.get("/api/admin/keys", dependencies=[Depends(_require_admin)])
def admin_list_keys(
    kind: Annotated[str | None, Query()] = None,
    status: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> dict:
    return {"keys": license_store.list_keys(kind=kind, status=status, limit=limit)}


@app.post("/api/admin/keys/{key_id}/revoke", dependencies=[Depends(_require_admin)])
def admin_revoke_key(key_id: int) -> dict:
    try:
        return {"key": license_store.revoke_key(key_id)}
    except KeyError:
        raise HTTPException(status_code=404, detail="卡密不存在") from None


@app.post("/api/admin/keys/{key_id}/unbind", dependencies=[Depends(_require_admin)])
def admin_unbind_key(key_id: int) -> dict:
    try:
        n = license_store.unbind_machines(key_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="卡密不存在") from None
    return {"ok": True, "unbound": n}


@app.get("/api/admin/keys/{key_id}/machines", dependencies=[Depends(_require_admin)])
def admin_key_machines(key_id: int) -> dict:
    if not license_store.get_key(key_id):
        raise HTTPException(status_code=404, detail="卡密不存在")
    return {"machines": license_store.list_machines(key_id)}


@app.get("/api/admin/events", dependencies=[Depends(_require_admin)])
def admin_events(
    event: Annotated[str | None, Query()] = None,
    machine_id: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> dict:
    return {
        "events": license_store.list_events(
            event=event, machine_id=machine_id, limit=limit
        )
    }


@app.get("/api/admin/feedbacks", dependencies=[Depends(_require_admin)])
def admin_feedbacks(limit: Annotated[int, Query(ge=1, le=500)] = 100) -> dict:
    return {"feedbacks": license_store.list_feedbacks(limit=limit)}


handler = Mangum(app, lifespan="off")
