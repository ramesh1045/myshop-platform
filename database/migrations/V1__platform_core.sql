-- =====================================================================
-- V1  PLATFORM CORE (global tables — owned by Super Admin, no tenant_id)
-- PDF §5.1 permissions are global, §9/§10 modules & plans, §5.4 themes
-- =====================================================================

-- Subscription plans (₹499 / ₹999 / ₹1,999 per month)  — PDF §10
CREATE TABLE plans (
  id                      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code                    VARCHAR(40)   NOT NULL,
  name                    VARCHAR(100)  NOT NULL,
  description             VARCHAR(500)  NULL,
  price_monthly           DECIMAL(10,2) NOT NULL DEFAULT 0,
  price_yearly            DECIMAL(10,2) NOT NULL DEFAULT 0,
  trial_days              SMALLINT UNSIGNED NOT NULL DEFAULT 14,
  max_products            INT UNSIGNED  NULL COMMENT 'NULL = unlimited',
  max_staff               INT UNSIGNED  NULL COMMENT 'NULL = unlimited (PDF §5.3 staff limit)',
  max_storage_mb          INT UNSIGNED  NULL,
  allow_custom_domain     TINYINT(1)    NOT NULL DEFAULT 0 COMMENT 'PDF §10: Pro and above only',
  allow_headless_api      TINYINT(1)    NOT NULL DEFAULT 0 COMMENT 'PDF §9: higher plan',
  transaction_fee_percent DECIMAL(5,2)  NOT NULL DEFAULT 0 COMMENT 'PDF §10: Basic plan 1% per order',
  is_public               TINYINT(1)    NOT NULL DEFAULT 1,
  is_active               TINYINT(1)    NOT NULL DEFAULT 1,
  sort_order              INT           NOT NULL DEFAULT 0,
  created_at              DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at              DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_plans_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Feature modules that can be switched on/off per tenant — PDF §3 step 9, §9
CREATE TABLE modules (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code                VARCHAR(40)   NOT NULL,
  name                VARCHAR(100)  NOT NULL,
  description         VARCHAR(500)  NULL,
  is_core             TINYINT(1)    NOT NULL DEFAULT 0 COMMENT 'core modules can never be disabled',
  is_addon            TINYINT(1)    NOT NULL DEFAULT 0 COMMENT 'sold as monthly add-on',
  addon_price_monthly DECIMAL(10,2) NOT NULL DEFAULT 0,
  is_active           TINYINT(1)    NOT NULL DEFAULT 1,
  sort_order          INT           NOT NULL DEFAULT 0,
  created_at          DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_modules_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Which modules each plan includes
CREATE TABLE plan_modules (
  plan_id   BIGINT UNSIGNED NOT NULL,
  module_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (plan_id, module_id),
  KEY ix_plan_modules_module (module_id),
  CONSTRAINT fk_plan_modules_plan   FOREIGN KEY (plan_id)   REFERENCES plans(id)   ON DELETE CASCADE,
  CONSTRAINT fk_plan_modules_module FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- GLOBAL permission list (PRODUCT_CREATE, ORDER_VIEW ...) — PDF §5.1
-- Backend code checks ONLY these codes; role names never matter.
CREATE TABLE permissions (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(60)  NOT NULL,
  name        VARCHAR(120) NOT NULL,
  group_name  VARCHAR(60)  NOT NULL COMMENT 'UI grouping for checkbox screen',
  module_code VARCHAR(40)  NULL COMMENT 'permission hidden when module is off',
  sort_order  INT          NOT NULL DEFAULT 0,
  UNIQUE KEY uq_permissions_code (code),
  KEY ix_permissions_module (module_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Super Admin users (admin.myshop.com) — PDF §4
CREATE TABLE platform_users (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(120) NOT NULL,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  last_login_at DATETIME(3)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_platform_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Themes = layer 1 (Angular layout components, built by developer) — PDF §5.4
-- owner_tenant_id NOT NULL => exclusive theme for one client (PDF §9), same codebase.
-- FK to tenants is added in V2 (tenants table does not exist yet).
CREATE TABLE themes (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code              VARCHAR(40)   NOT NULL COMMENT 'matches Angular lazy-loaded theme key',
  name              VARCHAR(100)  NOT NULL,
  description       VARCHAR(500)  NULL,
  preview_image_url VARCHAR(500)  NULL,
  is_premium        TINYINT(1)    NOT NULL DEFAULT 0 COMMENT 'PDF §10 premium theme one-time purchase',
  price             DECIMAL(10,2) NOT NULL DEFAULT 0,
  owner_tenant_id   BIGINT UNSIGNED NULL COMMENT 'PDF §9 exclusive theme',
  default_settings  JSON          NOT NULL COMMENT 'layer 2 defaults: colors, font, radius',
  default_sections  JSON          NOT NULL COMMENT 'layer 3 defaults: home page blocks',
  is_active         TINYINT(1)    NOT NULL DEFAULT 1,
  sort_order        INT           NOT NULL DEFAULT 0,
  created_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_themes_code (code),
  KEY ix_themes_owner (owner_tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Global menu catalogue for the Store Admin panel — PDF §5.2
-- A menu is shown only if the user has permission_code (and module is on).
CREATE TABLE menu_templates (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code            VARCHAR(60)  NOT NULL,
  parent_id       BIGINT UNSIGNED NULL,
  default_label   VARCHAR(100) NOT NULL,
  icon            VARCHAR(60)  NULL,
  route           VARCHAR(200) NOT NULL,
  permission_code VARCHAR(60)  NULL COMMENT 'NULL = visible to every logged-in staff',
  module_code     VARCHAR(40)  NULL,
  default_sort    INT          NOT NULL DEFAULT 0,
  UNIQUE KEY uq_menu_templates_code (code),
  KEY ix_menu_templates_parent (parent_id),
  CONSTRAINT fk_menu_templates_parent FOREIGN KEY (parent_id) REFERENCES menu_templates(id) ON DELETE CASCADE,
  CONSTRAINT fk_menu_templates_perm   FOREIGN KEY (permission_code) REFERENCES permissions(code) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Key/value platform configuration (GSTIN, state code, SAC, etc.)
CREATE TABLE platform_settings (
  setting_key   VARCHAR(80)  NOT NULL PRIMARY KEY,
  setting_value TEXT         NULL,
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
