-- Vercel Postgres / Neon 初始化脚本
-- 在 Vercel Dashboard → Storage → Postgres → Query 中执行，或用 psql $POSTGRES_URL_NON_POOLING -f postgres/init.sql

CREATE TABLE IF NOT EXISTS servers (
  id SERIAL PRIMARY KEY,
  server_key VARCHAR(64) NOT NULL UNIQUE,
  serverid INTEGER,
  server_name VARCHAR(64) NOT NULL DEFAULT '',
  area_name VARCHAR(64) NOT NULL DEFAULT '',
  gold_min_wan INTEGER,
  synced_at TIMESTAMP(6) NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id BIGSERIAL PRIMARY KEY,
  server_id INTEGER NOT NULL REFERENCES servers (id) ON DELETE CASCADE,
  ordersn VARCHAR(128) NOT NULL,
  area_name VARCHAR(64) NOT NULL DEFAULT '',
  server_name VARCHAR(64) NOT NULL DEFAULT '',
  role_name VARCHAR(64) NOT NULL DEFAULT '',
  school VARCHAR(32) NOT NULL DEFAULT '',
  level INTEGER,
  price NUMERIC(12, 2),
  gold BIGINT,
  frozen_gold_wan INTEGER,
  sale_status VARCHAR(16),
  selling_time BIGINT,
  payload JSONB NOT NULL,
  synced_at TIMESTAMP(6) NOT NULL,
  UNIQUE (server_id, ordersn)
);

CREATE INDEX IF NOT EXISTS idx_roles_area ON roles (area_name);
CREATE INDEX IF NOT EXISTS idx_roles_school ON roles (school);
CREATE INDEX IF NOT EXISTS idx_roles_price ON roles (price);
CREATE INDEX IF NOT EXISTS idx_roles_gold ON roles (gold);
CREATE INDEX IF NOT EXISTS idx_roles_sale_status ON roles (sale_status);
CREATE INDEX IF NOT EXISTS idx_roles_server_id ON roles (server_id);
