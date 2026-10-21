-- =====================================================================
-- V2  TENANTS (clients / shops), domains, settings, modules, limits,
--     subscriptions — PDF §2, §3, §7, §9, §10
-- =====================================================================

CREATE TABLE tenants (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid              CHAR(36)      NOT NULL,
  name              VARCHAR(150)  NOT NULL COMMENT 'shop name e.g. Kavya Textiles',
  subdomain         VARCHAR(63)   NOT NULL COMMENT 'kavya -> kavya.myshop.com',
  owner_name        VARCHAR(120)  NOT NULL,
  owner_email       VARCHAR(190)  NOT NULL,
  owner_mobile      VARCHAR(20)   NOT NULL,
  plan_id           BIGINT UNSIGNED NOT NULL,
  status            ENUM('PENDING_PAYMENT','TRIAL','ACTIVE','PAST_DUE','SUSPENDED','CANCELLED')
                    NOT NULL DEFAULT 'TRIAL',
  trial_ends_at     DATETIME(3)   NULL,
  suspended_at      DATETIME(3)   NULL,
  suspended_reason  VARCHAR(255)  NULL,
  gstin             VARCHAR(15)   NULL,
  legal_name        VARCHAR(200)  NULL,
  address_line1     VARCHAR(200)  NULL,
  address_line2     VARCHAR(200)  NULL,
  city              VARCHAR(100)  NULL,
  state             VARCHAR(100)  NULL,
  state_code        CHAR(2)       NULL COMMENT 'GST state code, decides CGST+SGST vs IGST',
  pincode           VARCHAR(10)   NULL,
  country           CHAR(2)       NOT NULL DEFAULT 'IN',
  currency          CHAR(3)       NOT NULL DEFAULT 'INR',
  timezone          VARCHAR(50)   NOT NULL DEFAULT 'Asia/Kolkata',
  created_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_tenants_uuid (uuid),
  UNIQUE KEY uq_tenants_subdomain (subdomain),
  KEY ix_tenants_status (status, created_at),
  KEY ix_tenants_plan (plan_id),
  CONSTRAINT fk_tenants_plan FOREIGN KEY (plan_id) REFERENCES plans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- exclusive theme owner FK (themes was created in V1)
ALTER TABLE themes
  ADD CONSTRAINT fk_themes_owner_tenant FOREIGN KEY (owner_tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;

-- Every host name that maps to a tenant: subdomain rows + custom domains — PDF §2
-- Request Host header -> this table -> tenant_id (cached in Redis)
CREATE TABLE tenant_domains (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id           BIGINT UNSIGNED NOT NULL,
  domain              VARCHAR(253) NOT NULL COMMENT 'lower-case FQDN, no port',
  type                ENUM('SUBDOMAIN','CUSTOM') NOT NULL,
  is_primary          TINYINT(1)   NOT NULL DEFAULT 0,
  verification_status ENUM('PENDING','VERIFIED','FAILED') NOT NULL DEFAULT 'PENDING',
  cname_target        VARCHAR(253) NULL COMMENT 'value client must put in CNAME, e.g. stores.myshop.com',
  last_checked_at     DATETIME(3)  NULL,
  last_check_error    VARCHAR(255) NULL,
  check_attempts      INT UNSIGNED NOT NULL DEFAULT 0,
  verified_at         DATETIME(3)  NULL,
  created_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_tenant_domains_domain (domain),
  KEY ix_tenant_domains_tenant (tenant_id, type),
  KEY ix_tenant_domains_pending (verification_status, last_checked_at),
  CONSTRAINT fk_tenant_domains_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Store settings: Razorpay keys (client's own), shipping fee, SEO — PDF §3 step 4, §3 step 8
CREATE TABLE tenant_settings (
  tenant_id                    BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  store_email                  VARCHAR(190)  NULL,
  store_phone                  VARCHAR(20)   NULL,
  whatsapp_number              VARCHAR(20)   NULL,
  razorpay_key_id              VARCHAR(100)  NULL,
  razorpay_key_secret_enc      VARBINARY(512) NULL COMMENT 'AES-256-GCM encrypted',
  razorpay_webhook_secret_enc  VARBINARY(512) NULL COMMENT 'AES-256-GCM encrypted',
  cod_enabled                  TINYINT(1)    NOT NULL DEFAULT 1,
  online_payment_enabled       TINYINT(1)    NOT NULL DEFAULT 0,
  shipping_flat_fee            DECIMAL(10,2) NOT NULL DEFAULT 0,
  free_shipping_above          DECIMAL(10,2) NULL,
  prices_include_tax           TINYINT(1)    NOT NULL DEFAULT 1,
  min_order_amount             DECIMAL(10,2) NOT NULL DEFAULT 0,
  seo_title                    VARCHAR(200)  NULL,
  seo_description              VARCHAR(500)  NULL,
  seo_keywords                 VARCHAR(500)  NULL,
  social_links                 JSON          NULL,
  google_analytics_id          VARCHAR(40)   NULL,
  updated_at                   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_tenant_settings_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Per-tenant overrides of plan limits (Super Admin "limits") — PDF §3 step 9
CREATE TABLE tenant_limits (
  tenant_id      BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  max_products   INT UNSIGNED NULL COMMENT 'NULL = use plan value',
  max_staff      INT UNSIGNED NULL,
  max_storage_mb INT UNSIGNED NULL,
  updated_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_tenant_limits_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Module on/off per tenant (plan modules + paid add-ons) — PDF §3 step 9, §9 tenant_modules
CREATE TABLE tenant_modules (
  tenant_id     BIGINT UNSIGNED NOT NULL,
  module_id     BIGINT UNSIGNED NOT NULL,
  is_enabled    TINYINT(1)    NOT NULL DEFAULT 1,
  source        ENUM('PLAN','ADDON','MANUAL') NOT NULL DEFAULT 'PLAN',
  price_monthly DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'add-on monthly fee',
  enabled_at    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at    DATETIME(3)   NULL,
  PRIMARY KEY (tenant_id, module_id),
  KEY ix_tenant_modules_module (module_id),
  CONSTRAINT fk_tenant_modules_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_tenant_modules_module FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Platform subscription of each tenant (auto-renewal) — PDF §3 step 9, §12 phase 4
CREATE TABLE subscriptions (
  id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id             BIGINT UNSIGNED NOT NULL,
  plan_id               BIGINT UNSIGNED NOT NULL,
  billing_cycle         ENUM('MONTHLY','YEARLY') NOT NULL DEFAULT 'MONTHLY',
  status                ENUM('TRIALING','ACTIVE','PAST_DUE','CANCELLED','EXPIRED') NOT NULL,
  amount                DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'plan price excl. GST',
  current_period_start  DATETIME(3)   NOT NULL,
  current_period_end    DATETIME(3)   NOT NULL,
  grace_until           DATETIME(3)   NULL COMMENT 'after this the store is suspended',
  auto_renew            TINYINT(1)    NOT NULL DEFAULT 1,
  cancel_at_period_end  TINYINT(1)    NOT NULL DEFAULT 0,
  razorpay_subscription_id VARCHAR(100) NULL,
  is_current            TINYINT(1)    NULL DEFAULT 1 COMMENT '1 for the live row, NULL for history (unique trick)',
  created_at            DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_subscriptions_current (tenant_id, is_current),
  KEY ix_subscriptions_renewal (status, current_period_end),
  KEY ix_subscriptions_plan (plan_id),
  CONSTRAINT fk_subscriptions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_subscriptions_plan   FOREIGN KEY (plan_id)   REFERENCES plans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Per-tenant gap-free counters (order numbers etc.), locked with SELECT ... FOR UPDATE
CREATE TABLE tenant_counters (
  tenant_id    BIGINT UNSIGNED NOT NULL,
  counter_name VARCHAR(40)     NOT NULL,
  value        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, counter_name),
  CONSTRAINT fk_tenant_counters_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
