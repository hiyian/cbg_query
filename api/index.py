from __future__ import annotations

import sys
from pathlib import Path
from typing import Annotated, Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from cbg.db import fetch_meta, fetch_roles, query_roles

app = FastAPI(title="MHCBG Query API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET"],
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


handler = Mangum(app, lifespan="off")
