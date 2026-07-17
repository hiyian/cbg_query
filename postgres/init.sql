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

-- ---------------- 寻觅助手：卡密 / 机器码 / 埋点 / 反馈 ----------------

CREATE TABLE IF NOT EXISTS license_keys (
  id SERIAL PRIMARY KEY,
  code VARCHAR(64) NOT NULL UNIQUE,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('test', 'official')),
  status VARCHAR(16) NOT NULL DEFAULT 'unused'
    CHECK (status IN ('unused', 'active', 'revoked', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  max_machines INTEGER,
  note TEXT NOT NULL DEFAULT '',
  session_token VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by VARCHAR(64) NOT NULL DEFAULT 'admin'
);

CREATE INDEX IF NOT EXISTS idx_license_keys_kind ON license_keys (kind);
CREATE INDEX IF NOT EXISTS idx_license_keys_status ON license_keys (status);
CREATE INDEX IF NOT EXISTS idx_license_keys_expires ON license_keys (expires_at);
CREATE INDEX IF NOT EXISTS idx_license_keys_session ON license_keys (session_token);

CREATE TABLE IF NOT EXISTS license_machines (
  id SERIAL PRIMARY KEY,
  key_id INTEGER NOT NULL REFERENCES license_keys (id) ON DELETE CASCADE,
  machine_id VARCHAR(128) NOT NULL,
  machine_label VARCHAR(256) NOT NULL DEFAULT '',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activate_count INTEGER NOT NULL DEFAULT 1,
  UNIQUE (key_id, machine_id)
);

CREATE INDEX IF NOT EXISTS idx_license_machines_key ON license_machines (key_id);
CREATE INDEX IF NOT EXISTS idx_license_machines_mid ON license_machines (machine_id);

CREATE TABLE IF NOT EXISTS analytics_events (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  machine_id VARCHAR(128) NOT NULL DEFAULT '',
  license_key_id INTEGER REFERENCES license_keys (id) ON DELETE SET NULL,
  event VARCHAR(64) NOT NULL,
  props JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_event ON analytics_events (event);
CREATE INDEX IF NOT EXISTS idx_analytics_events_occurred ON analytics_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_machine ON analytics_events (machine_id);

CREATE TABLE IF NOT EXISTS feedbacks (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  machine_id VARCHAR(128) NOT NULL DEFAULT '',
  license_key_id INTEGER REFERENCES license_keys (id) ON DELETE SET NULL,
  category VARCHAR(16) NOT NULL DEFAULT 'other'
    CHECK (category IN ('bug', 'feature', 'other')),
  content TEXT NOT NULL,
  contact VARCHAR(256) NOT NULL DEFAULT '',
  app_version VARCHAR(64) NOT NULL DEFAULT '',
  os VARCHAR(128) NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_feedbacks_created ON feedbacks (created_at DESC);
