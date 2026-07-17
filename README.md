# CBG 查询（Vercel 版）

藏宝阁角色查询的前后端，部署到 [Vercel](https://vercel.com)，数据库使用 **Vercel Postgres**（Neon）。

不含爬虫；数据由上级 `mhcbg` 项目抓取后，通过同步脚本写入 Postgres。

另含 **寻觅助手** 卡密管理：`/admin` 后台 + `/api/license*` / `/api/events` / `/api/feedback`。

## 目录

```
cbg_query/
├── api/index.py       # FastAPI + Vercel Serverless 入口
├── cbg/               # 查询逻辑 + license_store（卡密）
├── docs/              # 静态前端（含 docs/admin 管理页）
├── postgres/init.sql  # 建表 SQL（含 license_* / analytics / feedbacks）
├── scripts/           # 本地工具（不部署）
└── vercel.json        # 路由
```

## 1. 初始化 Postgres

在 Vercel 项目里：**Storage → Create Database → Postgres**，绑定到本项目。

然后在 Query 控制台执行 `postgres/init.sql`，或本地：

```bash
psql "$POSTGRES_URL_NON_POOLING" -f postgres/init.sql
```

若库已存在旧表，可只执行 `init.sql` 中「寻觅助手」相关的 `CREATE TABLE` 段落。

## 环境变量

| 变量 | 说明 |
|------|------|
| `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING` | Vercel 绑定后自动注入 |
| `ADMIN_TOKEN` | 管理后台口令（请求头 `X-Admin-Token`） |
| `APP_ID` | 客户端标识，默认 `xunmi` |

管理页：部署后打开 `https://你的域名/admin`，输入 `ADMIN_TOKEN`。

## 2. 同步数据（本地运行）

上级 `mhcbg` 项目抓取并写入 MySQL 后，执行：

```bash
cd cbg_query
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt pymysql

# 配置 Postgres（从 Vercel Dashboard 复制）
export POSTGRES_URL_NON_POOLING="postgresql://..."

# MySQL 默认读 ../mysql.config.json
python scripts/sync_from_mysql.py
```

## 3. 部署到 Vercel

```bash
cd cbg_query
npm i -g vercel   # 如未安装
vercel            # 首次关联项目
vercel --prod
```

或在 GitHub 导入仓库，**Root Directory** 设为 `cbg_query`。

Vercel 绑定 Postgres 后，`POSTGRES_URL` 等变量会自动注入，无需手动配置。

## 4. 本地开发

```bash
cd cbg_query
source .venv/bin/activate
pip install -r requirements.txt uvicorn

export POSTGRES_URL="postgresql://..."
uvicorn api.index:app --reload --port 8000

# 另开终端：前端（apiBase 临时改为 http://127.0.0.1:8000）
cd docs && python3 -m http.server 8080
```

## API

| 路径 | 说明 |
|------|------|
| `GET /api/health` | 健康检查 |
| `GET /api/meta` | 大区 / 门派 / 服务器列表 |
| `GET /api/roles?server_key=xxx` | 分页查询角色 |

## 环境变量

| 变量 | 说明 |
|------|------|
| `POSTGRES_URL` | Vercel Serverless 用（连接池） |
| `POSTGRES_URL_NON_POOLING` | 迁移 / sync 脚本用 |
| `DATABASE_URL` | 可选，本地开发备用 |

## 注意事项

- **国内访问**：Vercel 节点在海外，国内用户可能较慢
- **超时**：Hobby 计划函数超时约 10 秒，角色数据量大时注意
- **同步**：爬虫仍在 `mhcbg` 项目本地运行；本目录只负责查询展示
