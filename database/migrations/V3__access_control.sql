-- =====================================================================
-- V3  ACCESS CONTROL — store users/staff, dynamic roles, role permissions,
--     menus, invitations, tokens, audit log, impersonation, API keys
--     PDF §4, §5.1, §5.2, §5.3, §6, §9, §12 phase 2 & 5
-- Composite (tenant_id, id) keys + composite FKs make cross-tenant links
-- impossible at the database level (shop A role can never be given to shop B user).
-- =====================================================================

-- Store Owner + Staff (login at kavya.myshop.com/admin) — PDF §4
CREATE TABLE users (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id     BIGINT UNSIGNED NOT NULL,
  email         VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NULL COMMENT 'NULL until invitation accepted',
  name          VARCHAR(120) NOT NULL,
  mobile        VARCHAR(20)  NULL,
  is_owner      TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'owner implicitly has every permission',
  status        ENUM('INVITED','ACTIVE','DISABLED') NOT NULL DEFAULT 'INVITED',
  last_login_at DATETIME(3)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_users_tenant_email (tenant_id, email),
  UNIQUE KEY uq_users_tenant_id (tenant_id, id),
  KEY ix_users_tenant_status (tenant_id, status, created_at),
  CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Roles belong to the client — PDF §5.1. Two clients may both have "Store Manager";
-- they are different rows with different permissions.
CREATE TABLE roles (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id   BIGINT UNSIGNED NOT NULL,
  name        VARCHAR(80)  NOT NULL,
  description VARCHAR(255) NULL,
  is_system   TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'seeded default roles; still editable',
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_roles_tenant_name (tenant_id, name),
  UNIQUE KEY uq_roles_tenant_id (tenant_id, id),
  CONSTRAINT fk_roles_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Ticked permission checkboxes for each role
CREATE TABLE role_permissions (
  tenant_id     BIGINT UNSIGNED NOT NULL,
  role_id       BIGINT UNSIGNED NOT NULL,
  permission_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  KEY ix_role_permissions_tenant_role (tenant_id, role_id),
  KEY ix_role_permissions_perm (permission_id),
  CONSTRAINT fk_role_permissions_role FOREIGN KEY (tenant_id, role_id) REFERENCES roles(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_role_permissions_perm FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- A staff member can have one or many roles — PDF §5.3
CREATE TABLE user_roles (
  tenant_id BIGINT UNSIGNED NOT NULL,
  user_id   BIGINT UNSIGNED NOT NULL,
  role_id   BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, role_id),
  KEY ix_user_roles_tenant_user (tenant_id, user_id),
  KEY ix_user_roles_tenant_role (tenant_id, role_id),
  CONSTRAINT fk_user_roles_user FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_user_roles_role FOREIGN KEY (tenant_id, role_id) REFERENCES roles(tenant_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Staff invitation by email — PDF §5.3
CREATE TABLE user_invitations (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id   BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL COMMENT 'user row created with status INVITED',
  token_hash  CHAR(64)    NOT NULL COMMENT 'sha256 of the emailed token',
  invited_by  BIGINT UNSIGNED NULL,
  expires_at  DATETIME(3) NOT NULL,
  accepted_at DATETIME(3) NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_user_invitations_token (token_hash),
  KEY ix_user_invitations_tenant_user (tenant_id, user_id),
  CONSTRAINT fk_user_invitations_user FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Client's own menu customisation: rename, hide, drag & drop order — PDF §5.2
CREATE TABLE tenant_menus (
  tenant_id        BIGINT UNSIGNED NOT NULL,
  menu_template_id BIGINT UNSIGNED NOT NULL,
  custom_label     VARCHAR(100) NULL COMMENT 'NULL = use default_label',
  is_hidden        TINYINT(1)   NOT NULL DEFAULT 0,
  sort_order       INT          NOT NULL DEFAULT 0,
  updated_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, menu_template_id),
  KEY ix_tenant_menus_template (menu_template_id),
  CONSTRAINT fk_tenant_menus_tenant   FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_tenant_menus_template FOREIGN KEY (menu_template_id) REFERENCES menu_templates(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Refresh tokens for all 3 login types (JWT access tokens stay stateless) — PDF §7
CREATE TABLE refresh_tokens (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  subject_type ENUM('PLATFORM','USER','CUSTOMER') NOT NULL,
  subject_id   BIGINT UNSIGNED NOT NULL,
  tenant_id    BIGINT UNSIGNED NULL COMMENT 'NULL only for PLATFORM',
  token_hash   CHAR(64)    NOT NULL,
  expires_at   DATETIME(3) NOT NULL,
  revoked_at   DATETIME(3) NULL,
  created_ip   VARCHAR(45) NULL,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_refresh_tokens_hash (token_hash),
  KEY ix_refresh_tokens_subject (subject_type, subject_id),
  KEY ix_refresh_tokens_tenant (tenant_id),
  CONSTRAINT fk_refresh_tokens_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE password_resets (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  subject_type ENUM('PLATFORM','USER','CUSTOMER') NOT NULL,
  subject_id   BIGINT UNSIGNED NOT NULL,
  tenant_id    BIGINT UNSIGNED NULL,
  token_hash   CHAR(64)    NOT NULL,
  expires_at   DATETIME(3) NOT NULL,
  used_at      DATETIME(3) NULL,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_password_resets_hash (token_hash),
  KEY ix_password_resets_tenant (tenant_id),
  CONSTRAINT fk_password_resets_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Super Admin "login as client" for support — PDF §12 phase 5 impersonation
CREATE TABLE impersonation_sessions (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  platform_user_id BIGINT UNSIGNED NOT NULL,
  tenant_id        BIGINT UNSIGNED NOT NULL,
  user_id          BIGINT UNSIGNED NOT NULL COMMENT 'the store user being impersonated (owner)',
  reason           VARCHAR(255) NOT NULL,
  ip               VARCHAR(45)  NULL,
  started_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ended_at         DATETIME(3)  NULL,
  KEY ix_impersonation_tenant (tenant_id, started_at),
  KEY ix_impersonation_admin (platform_user_id),
  CONSTRAINT fk_impersonation_admin FOREIGN KEY (platform_user_id) REFERENCES platform_users(id),
  CONSTRAINT fk_impersonation_user  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Audit log — PDF §12 phase 2. tenant_id NULL = platform-level action.
CREATE TABLE audit_logs (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id        BIGINT UNSIGNED NULL,
  actor_type       ENUM('PLATFORM','USER','CUSTOMER','SYSTEM','API_KEY') NOT NULL,
  actor_id         BIGINT UNSIGNED NULL,
  impersonator_id  BIGINT UNSIGNED NULL COMMENT 'platform_users.id when action done while impersonating',
  action           VARCHAR(80)  NOT NULL COMMENT 'e.g. PRODUCT_CREATE, ROLE_UPDATE',
  entity_type      VARCHAR(60)  NULL,
  entity_id        VARCHAR(64)  NULL,
  old_values       JSON         NULL,
  new_values       JSON         NULL,
  ip               VARCHAR(45)  NULL,
  user_agent       VARCHAR(255) NULL,
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_audit_logs_tenant_time (tenant_id, created_at, id),
  KEY ix_audit_logs_tenant_entity (tenant_id, entity_type, entity_id),
  CONSTRAINT fk_audit_logs_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Headless API keys (client builds own website) — PDF §9
CREATE TABLE api_keys (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id    BIGINT UNSIGNED NOT NULL,
  name         VARCHAR(100) NOT NULL,
  key_prefix   CHAR(12)     NOT NULL COMMENT 'shown in UI, first chars of key',
  key_hash     CHAR(64)     NOT NULL COMMENT 'sha256 of full key; full key shown only once',
  scopes       JSON         NOT NULL,
  created_by   BIGINT UNSIGNED NULL,
  last_used_at DATETIME(3)  NULL,
  revoked_at   DATETIME(3)  NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_api_keys_hash (key_hash),
  KEY ix_api_keys_tenant (tenant_id, revoked_at),
  CONSTRAINT fk_api_keys_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
