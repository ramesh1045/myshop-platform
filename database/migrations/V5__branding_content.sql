-- =====================================================================
-- V5  BRANDING & CONTENT — theme customisation (Draft -> Publish),
--     premium theme purchases, page builder, form builder, Blog & Booking
--     add-on modules.  PDF §5.4, §9, §12 phase 3 & 5
-- =====================================================================

-- Layer 2 (customisation JSON) + Layer 3 (page sections) per tenant.
-- Exactly one DRAFT row and one PUBLISHED row per tenant.
CREATE TABLE tenant_theme_settings (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id    BIGINT UNSIGNED NOT NULL,
  stage        ENUM('DRAFT','PUBLISHED') NOT NULL,
  theme_id     BIGINT UNSIGNED NOT NULL,
  settings     JSON NOT NULL COMMENT '{colors:{primary,secondary,background,text,accent}, font, logoUrl, faviconUrl, bannerUrl, borderRadius}',
  sections     JSON NOT NULL COMMENT '[{id,type,enabled,config}] home page blocks in display order',
  version      INT UNSIGNED NOT NULL DEFAULT 1,
  updated_by   BIGINT UNSIGNED NULL,
  published_at DATETIME(3)  NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_tenant_theme_settings_stage (tenant_id, stage),
  KEY ix_tenant_theme_settings_theme (theme_id),
  CONSTRAINT fk_tts_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_tts_theme  FOREIGN KEY (theme_id)  REFERENCES themes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Premium theme one-time purchases — PDF §10
CREATE TABLE tenant_themes (
  tenant_id    BIGINT UNSIGNED NOT NULL,
  theme_id     BIGINT UNSIGNED NOT NULL,
  amount_paid  DECIMAL(10,2) NOT NULL DEFAULT 0,
  invoice_id   BIGINT UNSIGNED NULL COMMENT 'FK added in V6',
  acquired_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, theme_id),
  KEY ix_tenant_themes_theme (theme_id),
  CONSTRAINT fk_tenant_themes_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_tenant_themes_theme  FOREIGN KEY (theme_id)  REFERENCES themes(id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Page builder: About / Gallery / Contact pages made of section blocks — PDF §9
CREATE TABLE pages (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  title           VARCHAR(150) NOT NULL,
  slug            VARCHAR(160) NOT NULL,
  sections        JSON         NOT NULL COMMENT 'draft sections',
  published_sections JSON      NULL     COMMENT 'live sections (NULL = never published)',
  status          ENUM('DRAFT','PUBLISHED') NOT NULL DEFAULT 'DRAFT',
  show_in_nav     TINYINT(1)   NOT NULL DEFAULT 1,
  nav_order       INT          NOT NULL DEFAULT 0,
  seo_title       VARCHAR(200) NULL,
  seo_description VARCHAR(500) NULL,
  published_at    DATETIME(3)  NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_pages_tenant_slug (tenant_id, slug),
  KEY ix_pages_tenant_status_nav (tenant_id, status, show_in_nav, nav_order),
  CONSTRAINT fk_pages_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Form builder (used inside pages, e.g. Contact form) — PDF §9
CREATE TABLE forms (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  name            VARCHAR(120) NOT NULL,
  fields          JSON         NOT NULL COMMENT '[{key,label,type,required,options}]',
  notify_email    VARCHAR(190) NULL,
  success_message VARCHAR(300) NOT NULL DEFAULT 'Thank you! We will contact you soon.',
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_forms_tenant_id (tenant_id, id),
  CONSTRAINT fk_forms_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE form_submissions (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id  BIGINT UNSIGNED NOT NULL,
  form_id    BIGINT UNSIGNED NOT NULL,
  data       JSON         NOT NULL,
  ip         VARCHAR(45)  NULL,
  is_read    TINYINT(1)   NOT NULL DEFAULT 0,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_form_submissions_tenant_form (tenant_id, form_id, created_at),
  CONSTRAINT fk_form_submissions_form FOREIGN KEY (tenant_id, form_id) REFERENCES forms(tenant_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- BLOG add-on module — PDF §9
CREATE TABLE blog_posts (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  title           VARCHAR(200) NOT NULL,
  slug            VARCHAR(220) NOT NULL,
  excerpt         VARCHAR(500) NULL,
  content         MEDIUMTEXT   NOT NULL,
  cover_image_url VARCHAR(500) NULL,
  status          ENUM('DRAFT','PUBLISHED') NOT NULL DEFAULT 'DRAFT',
  author_id       BIGINT UNSIGNED NULL,
  seo_title       VARCHAR(200) NULL,
  seo_description VARCHAR(500) NULL,
  published_at    DATETIME(3)  NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_blog_posts_tenant_slug (tenant_id, slug),
  KEY ix_blog_posts_tenant_status_pub (tenant_id, status, published_at, id),
  CONSTRAINT fk_blog_posts_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- BOOKING add-on module — PDF §9
CREATE TABLE booking_services (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id        BIGINT UNSIGNED NOT NULL,
  name             VARCHAR(150)  NOT NULL,
  description      VARCHAR(500)  NULL,
  duration_minutes INT UNSIGNED  NOT NULL DEFAULT 30,
  price            DECIMAL(10,2) NOT NULL DEFAULT 0,
  slots_per_time   INT UNSIGNED  NOT NULL DEFAULT 1 COMMENT 'how many bookings allowed in the same slot',
  is_active        TINYINT(1)    NOT NULL DEFAULT 1,
  created_at       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_booking_services_tenant_id (tenant_id, id),
  CONSTRAINT fk_booking_services_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE bookings (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  service_id      BIGINT UNSIGNED NOT NULL,
  customer_id     BIGINT UNSIGNED NULL,
  customer_name   VARCHAR(120) NOT NULL,
  customer_mobile VARCHAR(20)  NOT NULL,
  customer_email  VARCHAR(190) NULL,
  booking_date    DATE         NOT NULL,
  start_time      TIME         NOT NULL,
  status          ENUM('PENDING','CONFIRMED','COMPLETED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  notes           VARCHAR(500) NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY ix_bookings_tenant_date (tenant_id, booking_date, start_time),
  KEY ix_bookings_tenant_service_slot (tenant_id, service_id, booking_date, start_time),
  CONSTRAINT fk_bookings_service  FOREIGN KEY (tenant_id, service_id)  REFERENCES booking_services(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_bookings_customer FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
