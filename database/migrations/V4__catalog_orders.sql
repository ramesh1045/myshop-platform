-- =====================================================================
-- V4  CATALOG, CUSTOMERS, ORDERS, PAYMENTS, COUPONS, MEDIA
--     PDF §3 steps 4 & 8, §4 Customer, §7 (all clients in same tables
--     with tenant_id), §8 (indexes always START with tenant_id)
-- =====================================================================

CREATE TABLE categories (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  parent_id       BIGINT UNSIGNED NULL,
  name            VARCHAR(120) NOT NULL,
  slug            VARCHAR(140) NOT NULL,
  description     TEXT         NULL,
  image_url       VARCHAR(500) NULL,
  sort_order      INT          NOT NULL DEFAULT 0,
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  seo_title       VARCHAR(200) NULL,
  seo_description VARCHAR(500) NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_categories_tenant_slug (tenant_id, slug),
  UNIQUE KEY uq_categories_tenant_id (tenant_id, id),
  KEY ix_categories_tenant_parent (tenant_id, parent_id, sort_order),
  CONSTRAINT fk_categories_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_categories_parent FOREIGN KEY (tenant_id, parent_id) REFERENCES categories(tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE products (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id        BIGINT UNSIGNED NOT NULL,
  category_id      BIGINT UNSIGNED NULL,
  name             VARCHAR(200)  NOT NULL,
  slug             VARCHAR(220)  NOT NULL,
  short_description VARCHAR(500) NULL,
  description      MEDIUMTEXT    NULL,
  sku              VARCHAR(64)   NULL,
  price            DECIMAL(12,2) NOT NULL,
  compare_at_price DECIMAL(12,2) NULL COMMENT 'MRP / strike-through price',
  cost_price       DECIMAL(12,2) NULL,
  track_inventory  TINYINT(1)    NOT NULL DEFAULT 1,
  stock_qty        INT           NOT NULL DEFAULT 0,
  status           ENUM('DRAFT','ACTIVE','ARCHIVED') NOT NULL DEFAULT 'DRAFT',
  is_featured      TINYINT(1)    NOT NULL DEFAULT 0,
  hsn_code         VARCHAR(10)   NULL,
  gst_rate         DECIMAL(5,2)  NOT NULL DEFAULT 0 COMMENT 'percent, e.g. 5.00 / 12.00 / 18.00',
  weight_grams     INT UNSIGNED  NULL,
  seo_title        VARCHAR(200)  NULL,
  seo_description  VARCHAR(500)  NULL,
  created_at       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_products_tenant_slug (tenant_id, slug),
  UNIQUE KEY uq_products_tenant_sku (tenant_id, sku),
  UNIQUE KEY uq_products_tenant_id (tenant_id, id),
  -- PDF §8 example index: (tenant_id, status, created_at)
  KEY ix_products_tenant_status_created (tenant_id, status, created_at),
  -- keyset (cursor) pagination for storefront scroll: WHERE tenant_id=? AND status='ACTIVE' AND id < ?
  KEY ix_products_tenant_status_id (tenant_id, status, id),
  KEY ix_products_tenant_category (tenant_id, category_id, status, id),
  KEY ix_products_tenant_featured (tenant_id, is_featured, status),
  FULLTEXT KEY ft_products_search (name, short_description),
  CONSTRAINT fk_products_tenant   FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_products_category FOREIGN KEY (tenant_id, category_id) REFERENCES categories(tenant_id, id),
  CONSTRAINT chk_products_price CHECK (price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE product_images (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id   BIGINT UNSIGNED NOT NULL,
  product_id  BIGINT UNSIGNED NOT NULL,
  url         VARCHAR(500) NOT NULL COMMENT 'CDN url',
  storage_key VARCHAR(300) NULL COMMENT 'object storage key',
  alt_text    VARCHAR(200) NULL,
  sort_order  INT          NOT NULL DEFAULT 0,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_product_images_tenant_product (tenant_id, product_id, sort_order),
  CONSTRAINT fk_product_images_product FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Customers are separate per shop (same email can register in 2 shops) — PDF §4
CREATE TABLE customers (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id     BIGINT UNSIGNED NOT NULL,
  name          VARCHAR(120) NOT NULL,
  email         VARCHAR(190) NULL,
  mobile        VARCHAR(20)  NOT NULL,
  password_hash VARCHAR(255) NULL COMMENT 'NULL = guest customer created at checkout',
  status        ENUM('ACTIVE','BLOCKED') NOT NULL DEFAULT 'ACTIVE',
  last_login_at DATETIME(3)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_customers_tenant_mobile (tenant_id, mobile),
  UNIQUE KEY uq_customers_tenant_email (tenant_id, email),
  UNIQUE KEY uq_customers_tenant_id (tenant_id, id),
  KEY ix_customers_tenant_created (tenant_id, created_at),
  CONSTRAINT fk_customers_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE customer_addresses (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id     BIGINT UNSIGNED NOT NULL,
  customer_id   BIGINT UNSIGNED NOT NULL,
  name          VARCHAR(120) NOT NULL,
  mobile        VARCHAR(20)  NOT NULL,
  line1         VARCHAR(200) NOT NULL,
  line2         VARCHAR(200) NULL,
  city          VARCHAR(100) NOT NULL,
  state         VARCHAR(100) NOT NULL,
  pincode       VARCHAR(10)  NOT NULL,
  is_default    TINYINT(1)   NOT NULL DEFAULT 0,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_customer_addresses_tenant_customer (tenant_id, customer_id),
  CONSTRAINT fk_customer_addresses_customer FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Coupons — PDF §12 phase 5
CREATE TABLE coupons (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id          BIGINT UNSIGNED NOT NULL,
  code               VARCHAR(40)   NOT NULL,
  description        VARCHAR(255)  NULL,
  discount_type      ENUM('PERCENT','FLAT') NOT NULL,
  discount_value     DECIMAL(10,2) NOT NULL,
  max_discount       DECIMAL(10,2) NULL COMMENT 'cap for PERCENT coupons',
  min_order_amount   DECIMAL(10,2) NOT NULL DEFAULT 0,
  starts_at          DATETIME(3)   NULL,
  ends_at            DATETIME(3)   NULL,
  usage_limit        INT UNSIGNED  NULL COMMENT 'total uses, NULL = unlimited',
  usage_per_customer INT UNSIGNED  NULL,
  used_count         INT UNSIGNED  NOT NULL DEFAULT 0,
  is_active          TINYINT(1)    NOT NULL DEFAULT 1,
  created_at         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_coupons_tenant_code (tenant_id, code),
  UNIQUE KEY uq_coupons_tenant_id (tenant_id, id),
  CONSTRAINT fk_coupons_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT chk_coupons_value CHECK (discount_value > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Orders — money goes straight to the client's Razorpay account (PDF §3 step 8)
CREATE TABLE orders (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id           BIGINT UNSIGNED NOT NULL,
  order_number        VARCHAR(30)   NOT NULL COMMENT 'per-tenant sequence, e.g. KAV-000123',
  customer_id         BIGINT UNSIGNED NULL,
  status              ENUM('PENDING','CONFIRMED','PACKED','SHIPPED','DELIVERED','CANCELLED','RETURNED')
                      NOT NULL DEFAULT 'PENDING',
  payment_method      ENUM('COD','RAZORPAY') NOT NULL,
  payment_status      ENUM('PENDING','PAID','FAILED','REFUNDED') NOT NULL DEFAULT 'PENDING',
  subtotal            DECIMAL(12,2) NOT NULL,
  discount_total      DECIMAL(12,2) NOT NULL DEFAULT 0,
  shipping_fee        DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_total           DECIMAL(12,2) NOT NULL DEFAULT 0,
  grand_total         DECIMAL(12,2) NOT NULL,
  coupon_id           BIGINT UNSIGNED NULL,
  coupon_code         VARCHAR(40)   NULL,
  customer_name       VARCHAR(120)  NOT NULL,
  customer_email      VARCHAR(190)  NULL,
  customer_mobile     VARCHAR(20)   NOT NULL,
  ship_line1          VARCHAR(200)  NOT NULL,
  ship_line2          VARCHAR(200)  NULL,
  ship_city           VARCHAR(100)  NOT NULL,
  ship_state          VARCHAR(100)  NOT NULL,
  ship_pincode        VARCHAR(10)   NOT NULL,
  notes               VARCHAR(500)  NULL,
  tracking_number     VARCHAR(100)  NULL,
  courier_name        VARCHAR(100)  NULL,
  razorpay_order_id   VARCHAR(100)  NULL,
  placed_at           DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at          DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_orders_tenant_number (tenant_id, order_number),
  UNIQUE KEY uq_orders_tenant_id (tenant_id, id),
  UNIQUE KEY uq_orders_razorpay_order (razorpay_order_id),
  KEY ix_orders_tenant_status_created (tenant_id, status, created_at),
  KEY ix_orders_tenant_created (tenant_id, created_at),
  KEY ix_orders_tenant_customer (tenant_id, customer_id, created_at),
  KEY ix_orders_tenant_mobile (tenant_id, customer_mobile),
  CONSTRAINT fk_orders_tenant   FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_orders_customer FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id),
  CONSTRAINT fk_orders_coupon   FOREIGN KEY (tenant_id, coupon_id)   REFERENCES coupons(tenant_id, id),
  CONSTRAINT chk_orders_total CHECK (grand_total >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE order_items (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id    BIGINT UNSIGNED NOT NULL,
  order_id     BIGINT UNSIGNED NOT NULL,
  product_id   BIGINT UNSIGNED NULL,
  product_name VARCHAR(200)  NOT NULL COMMENT 'snapshot at order time',
  sku          VARCHAR(64)   NULL,
  hsn_code     VARCHAR(10)   NULL,
  unit_price   DECIMAL(12,2) NOT NULL,
  quantity     INT UNSIGNED  NOT NULL,
  gst_rate     DECIMAL(5,2)  NOT NULL DEFAULT 0,
  tax_amount   DECIMAL(12,2) NOT NULL DEFAULT 0,
  line_total   DECIMAL(12,2) NOT NULL,
  KEY ix_order_items_tenant_order (tenant_id, order_id),
  KEY ix_order_items_tenant_product (tenant_id, product_id),
  CONSTRAINT fk_order_items_order   FOREIGN KEY (tenant_id, order_id)   REFERENCES orders(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_order_items_product FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id),
  CONSTRAINT chk_order_items_qty CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Order tracking timeline — PDF §4 Customer "order track"
CREATE TABLE order_status_history (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id   BIGINT UNSIGNED NOT NULL,
  order_id    BIGINT UNSIGNED NOT NULL,
  from_status VARCHAR(20)  NULL,
  to_status   VARCHAR(20)  NOT NULL,
  note        VARCHAR(500) NULL,
  changed_by  BIGINT UNSIGNED NULL COMMENT 'users.id; NULL = system/customer',
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_order_status_history_order (tenant_id, order_id, created_at),
  CONSTRAINT fk_order_status_history_order FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Store payments (customer -> client, via client's own Razorpay keys)
CREATE TABLE payments (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id           BIGINT UNSIGNED NOT NULL,
  order_id            BIGINT UNSIGNED NOT NULL,
  provider            ENUM('RAZORPAY','COD') NOT NULL,
  provider_order_id   VARCHAR(100)  NULL,
  provider_payment_id VARCHAR(100)  NULL,
  amount              DECIMAL(12,2) NOT NULL,
  status              ENUM('CREATED','CAPTURED','FAILED','REFUNDED') NOT NULL DEFAULT 'CREATED',
  raw_payload         JSON          NULL,
  created_at          DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_payments_provider_payment (provider_payment_id),
  KEY ix_payments_tenant_order (tenant_id, order_id),
  CONSTRAINT fk_payments_order FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE coupon_redemptions (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id   BIGINT UNSIGNED NOT NULL,
  coupon_id   BIGINT UNSIGNED NOT NULL,
  order_id    BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NULL,
  customer_mobile VARCHAR(20) NOT NULL,
  discount    DECIMAL(12,2) NOT NULL,
  created_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_coupon_redemptions_order (tenant_id, order_id),
  KEY ix_coupon_redemptions_coupon_mobile (tenant_id, coupon_id, customer_mobile),
  CONSTRAINT fk_coupon_redemptions_coupon FOREIGN KEY (tenant_id, coupon_id) REFERENCES coupons(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_coupon_redemptions_order  FOREIGN KEY (tenant_id, order_id)  REFERENCES orders(tenant_id, id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Uploaded files in S3-compatible object storage — PDF §6, §11 (storage limit tracking)
CREATE TABLE media_files (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id    BIGINT UNSIGNED NOT NULL,
  storage_key  VARCHAR(300) NOT NULL,
  url          VARCHAR(500) NOT NULL,
  mime_type    VARCHAR(100) NOT NULL,
  size_bytes   BIGINT UNSIGNED NOT NULL,
  original_name VARCHAR(255) NULL,
  uploaded_by  BIGINT UNSIGNED NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_media_files_key (storage_key),
  KEY ix_media_files_tenant_created (tenant_id, created_at),
  CONSTRAINT fk_media_files_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
