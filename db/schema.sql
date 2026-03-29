CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  recovery_salt TEXT NOT NULL,
  recovery_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS projects (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  project_name TEXT NOT NULL,
  is_autosave BOOLEAN NOT NULL DEFAULT FALSE,
  project_data JSONB NOT NULL,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_saved_at ON projects(saved_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_autosave ON projects(user_id, is_autosave);

CREATE TABLE IF NOT EXISTS climate_stations (
  id BIGSERIAL PRIMARY KEY,
  station_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'ashrae',
  source_version TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT '',
  wmo_code TEXT NOT NULL DEFAULT '',
  latitude NUMERIC(9, 5),
  longitude NUMERIC(9, 5),
  elevation_m NUMERIC(10, 2),
  climate_zone TEXT NOT NULL DEFAULT '',
  koppen TEXT NOT NULL DEFAULT '',
  dbt_04_c NUMERIC(8, 3),
  wbt_coincident_c NUMERIC(8, 3),
  wbt_04_c NUMERIC(8, 3),
  mean_daily_range_c NUMERIC(8, 3),
  heating_99_6_c NUMERIC(8, 3),
  rh_percent NUMERIC(6, 2),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_climate_stations_region ON climate_stations(region);
CREATE INDEX IF NOT EXISTS idx_climate_stations_city_lower ON climate_stations(LOWER(city));
CREATE INDEX IF NOT EXISTS idx_climate_stations_zone ON climate_stations(climate_zone);
CREATE INDEX IF NOT EXISTS idx_climate_stations_source ON climate_stations(source, source_version);

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL DEFAULT '',
  primary_email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'prospect' CHECK (status IN ('prospect', 'active', 'inactive', 'suspended')),
  active_license_id TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_companies_slug ON companies(slug);
CREATE INDEX IF NOT EXISTS idx_companies_status ON companies(status);
CREATE INDEX IF NOT EXISTS idx_companies_primary_email ON companies(LOWER(primary_email));

ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_id TEXT REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by_user_id TEXT;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('owner', 'admin', 'user'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users(LOWER(username)) WHERE username IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS licensing_plans (
  plan_code TEXT PRIMARY KEY,
  plan_name TEXT NOT NULL,
  license_type TEXT NOT NULL CHECK (license_type IN ('annual', 'source')),
  user_min INTEGER NOT NULL DEFAULT 1,
  user_max INTEGER NOT NULL DEFAULT 1,
  user_limit INTEGER NOT NULL DEFAULT 1,
  annual_price_inr INTEGER NOT NULL DEFAULT 0,
  duration_months INTEGER NOT NULL DEFAULT 12,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS company_pricing_overrides (
  id BIGSERIAL PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL REFERENCES licensing_plans(plan_code) ON DELETE CASCADE,
  annual_price_inr INTEGER NOT NULL,
  user_limit INTEGER,
  note TEXT NOT NULL DEFAULT '',
  updated_by_user_id TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, plan_code)
);

CREATE INDEX IF NOT EXISTS idx_company_pricing_overrides_company_id ON company_pricing_overrides(company_id);

CREATE TABLE IF NOT EXISTS lead_requests (
  id BIGSERIAL PRIMARY KEY,
  request_type TEXT NOT NULL CHECK (request_type IN ('demo', 'quote')),
  name TEXT NOT NULL,
  company_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  requested_users INTEGER NOT NULL DEFAULT 0,
  plan_code TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'closed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_requests_type ON lead_requests(request_type);
CREATE INDEX IF NOT EXISTS idx_lead_requests_status ON lead_requests(status);
CREATE INDEX IF NOT EXISTS idx_lead_requests_created_at ON lead_requests(created_at DESC);

CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  license_number TEXT NOT NULL UNIQUE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL REFERENCES licensing_plans(plan_code) ON DELETE RESTRICT,
  license_type TEXT NOT NULL CHECK (license_type IN ('annual', 'source')),
  user_limit INTEGER NOT NULL,
  amount_inr INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  duration_months INTEGER NOT NULL DEFAULT 12,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'expired', 'cancelled')),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed', 'waived')),
  admin_user_id TEXT NOT NULL DEFAULT '',
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_licenses_company_id ON licenses(company_id);
CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);
CREATE INDEX IF NOT EXISTS idx_licenses_payment_status ON licenses(payment_status);

CREATE TABLE IF NOT EXISTS license_payments (
  id BIGSERIAL PRIMARY KEY,
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  license_id TEXT REFERENCES licenses(id) ON DELETE SET NULL,
  plan_code TEXT NOT NULL DEFAULT '',
  purchaser_name TEXT NOT NULL,
  purchaser_email TEXT NOT NULL,
  purchaser_phone TEXT NOT NULL DEFAULT '',
  company_name TEXT NOT NULL,
  requested_users INTEGER NOT NULL DEFAULT 0,
  amount_inr INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  gateway TEXT NOT NULL DEFAULT 'razorpay',
  gateway_order_id TEXT NOT NULL DEFAULT '',
  gateway_payment_id TEXT NOT NULL DEFAULT '',
  gateway_signature TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed', 'cancelled')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_license_payments_company_id ON license_payments(company_id);
CREATE INDEX IF NOT EXISTS idx_license_payments_order_id ON license_payments(gateway_order_id);
CREATE INDEX IF NOT EXISTS idx_license_payments_status ON license_payments(status);

CREATE TABLE IF NOT EXISTS license_checkout_invites (
  id BIGSERIAL PRIMARY KEY,
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL REFERENCES licensing_plans(plan_code) ON DELETE CASCADE,
  contact_name TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  company_name TEXT NOT NULL,
  requested_users INTEGER NOT NULL DEFAULT 1,
  annual_price_inr INTEGER NOT NULL DEFAULT 0,
  user_limit INTEGER,
  note TEXT NOT NULL DEFAULT '',
  created_by_user_id TEXT NOT NULL DEFAULT '',
  token_hash TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  opened_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_license_checkout_invites_company_id ON license_checkout_invites(company_id);
CREATE INDEX IF NOT EXISTS idx_license_checkout_invites_token_hash ON license_checkout_invites(token_hash);
CREATE INDEX IF NOT EXISTS idx_license_checkout_invites_expires_at ON license_checkout_invites(expires_at);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token_hash ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at);

INSERT INTO licensing_plans (plan_code, plan_name, license_type, user_min, user_max, user_limit, annual_price_inr, duration_months, is_active, metadata)
VALUES
  ('annual_5', 'Company Annual · Up to 5 Users', 'annual', 1, 5, 5, 25000, 12, TRUE, '{"displayOrder":1}'::jsonb),
  ('annual_10', 'Company Annual · 6 to 10 Users', 'annual', 6, 10, 10, 40000, 12, TRUE, '{"displayOrder":2}'::jsonb),
  ('annual_15', 'Company Annual · 11 to 15 Users', 'annual', 11, 15, 15, 60000, 12, TRUE, '{"displayOrder":3}'::jsonb),
  ('source', 'Source License', 'source', 1, 999, 999, 500000, 0, TRUE, '{"displayOrder":4}'::jsonb)
ON CONFLICT (plan_code) DO UPDATE SET
  plan_name = EXCLUDED.plan_name,
  license_type = EXCLUDED.license_type,
  user_min = EXCLUDED.user_min,
  user_max = EXCLUDED.user_max,
  user_limit = EXCLUDED.user_limit,
  annual_price_inr = EXCLUDED.annual_price_inr,
  duration_months = EXCLUDED.duration_months,
  is_active = EXCLUDED.is_active,
  metadata = EXCLUDED.metadata,
  updated_at = NOW();
