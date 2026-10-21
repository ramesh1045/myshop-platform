-- =====================================================================
-- V6  PLATFORM BILLING (your revenue) — GST invoices, platform payments,
--     transaction fees, setup/custom-design service requests, notifications
--     PDF §10 (all 6 revenue streams), §12 phase 4
-- =====================================================================

-- GST invoices you raise to clients — PDF §12 phase 4
CREATE TABLE platform_invoices (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  invoice_number   VARCHAR(30)   NOT NULL COMMENT 'e.g. MS/2026-27/000123 (FY-wise sequence)',
  tenant_id        BIGINT UNSIGNED NOT NULL,
  subscription_id  BIGINT UNSIGNED NULL,
  invoice_type     ENUM('SUBSCRIPTION','ADDON','THEME','SETUP','CUSTOM_DESIGN','TRANSACTION_FEE','OTHER') NOT NULL,
  status           ENUM('DRAFT','ISSUED','PAID','VOID') NOT NULL DEFAULT 'ISSUED',
  bill_to_name     VARCHAR(200)  NOT NULL,
  bill_to_gstin    VARCHAR(15)   NULL,
  bill_to_address  VARCHAR(500)  NULL,
  place_of_supply  CHAR(2)       NULL COMMENT 'GST state code',
  subtotal         DECIMAL(12,2) NOT NULL,
  cgst_rate        DECIMAL(5,2)  NOT NULL DEFAULT 0,
  cgst_amount      DECIMAL(12,2) NOT NULL DEFAULT 0,
  sgst_rate        DECIMAL(5,2)  NOT NULL DEFAULT 0,
  sgst_amount      DECIMAL(12,2) NOT NULL DEFAULT 0,
  igst_rate        DECIMAL(5,2)  NOT NULL DEFAULT 0,
  igst_amount      DECIMAL(12,2) NOT NULL DEFAULT 0,
  total            DECIMAL(12,2) NOT NULL,
  period_start     DATETIME(3)   NULL,
  period_end       DATETIME(3)   NULL,
  issued_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  due_at           DATETIME(3)   NULL,
  paid_at          DATETIME(3)   NULL,
  razorpay_order_id VARCHAR(100) NULL,
  created_at       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_platform_invoices_number (invoice_number),
  UNIQUE KEY uq_platform_invoices_rzp (razorpay_order_id),
  KEY ix_platform_invoices_tenant (tenant_id, issued_at),
  KEY ix_platform_invoices_status (status, due_at),
  CONSTRAINT fk_platform_invoices_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_platform_invoices_sub    FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE platform_invoice_items (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  invoice_id  BIGINT UNSIGNED NOT NULL,
  description VARCHAR(255)  NOT NULL,
  sac_code    VARCHAR(10)   NOT NULL,
  quantity    DECIMAL(10,2) NOT NULL DEFAULT 1,
  unit_price  DECIMAL(12,2) NOT NULL,
  amount      DECIMAL(12,2) NOT NULL,
  ref_type    VARCHAR(40)   NULL COMMENT 'PLAN / MODULE / THEME / SERVICE_REQUEST / TXN_FEE',
  ref_id      BIGINT UNSIGNED NULL,
  KEY ix_platform_invoice_items_invoice (invoice_id),
  CONSTRAINT fk_platform_invoice_items_invoice FOREIGN KEY (invoice_id) REFERENCES platform_invoices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Payments received into YOUR Razorpay account (platform billing) — PDF §11
CREATE TABLE platform_payments (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id           BIGINT UNSIGNED NOT NULL,
  invoice_id          BIGINT UNSIGNED NOT NULL,
  razorpay_order_id   VARCHAR(100)  NOT NULL,
  razorpay_payment_id VARCHAR(100)  NULL,
  amount              DECIMAL(12,2) NOT NULL,
  status              ENUM('CREATED','CAPTURED','FAILED') NOT NULL DEFAULT 'CREATED',
  raw_payload         JSON          NULL,
  created_at          DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_platform_payments_payment (razorpay_payment_id),
  KEY ix_platform_payments_invoice (invoice_id),
  KEY ix_platform_payments_tenant (tenant_id, created_at),
  CONSTRAINT fk_platform_payments_tenant  FOREIGN KEY (tenant_id)  REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_platform_payments_invoice FOREIGN KEY (invoice_id) REFERENCES platform_invoices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE tenant_themes
  ADD CONSTRAINT fk_tenant_themes_invoice FOREIGN KEY (invoice_id) REFERENCES platform_invoices(id) ON DELETE SET NULL;

-- Optional 1% per-order fee on Basic plan — PDF §10. Billed on next renewal invoice.
CREATE TABLE transaction_fees (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id    BIGINT UNSIGNED NOT NULL,
  order_id     BIGINT UNSIGNED NOT NULL,
  order_amount DECIMAL(12,2) NOT NULL,
  fee_percent  DECIMAL(5,2)  NOT NULL,
  fee_amount   DECIMAL(12,2) NOT NULL,
  invoice_id   BIGINT UNSIGNED NULL COMMENT 'set when billed',
  created_at   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_transaction_fees_order (tenant_id, order_id),
  KEY ix_transaction_fees_unbilled (tenant_id, invoice_id),
  CONSTRAINT fk_transaction_fees_order   FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_transaction_fees_invoice FOREIGN KEY (invoice_id) REFERENCES platform_invoices(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Store setup service (₹5,000), custom design, custom module requests — PDF §9, §10
CREATE TABLE service_requests (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id     BIGINT UNSIGNED NOT NULL,
  request_type  ENUM('STORE_SETUP','CUSTOM_DESIGN','CUSTOM_MODULE','EXCLUSIVE_THEME','OTHER') NOT NULL,
  title         VARCHAR(200)  NOT NULL,
  description   TEXT          NULL,
  quoted_amount DECIMAL(12,2) NULL,
  monthly_addon DECIMAL(12,2) NULL COMMENT 'recurring add-on fee for custom module',
  status        ENUM('NEW','QUOTED','ACCEPTED','IN_PROGRESS','DONE','REJECTED') NOT NULL DEFAULT 'NEW',
  invoice_id    BIGINT UNSIGNED NULL,
  created_by    BIGINT UNSIGNED NULL COMMENT 'users.id of requester',
  created_at    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY ix_service_requests_status (status, created_at),
  KEY ix_service_requests_tenant (tenant_id, created_at),
  CONSTRAINT fk_service_requests_tenant  FOREIGN KEY (tenant_id)  REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_service_requests_invoice FOREIGN KEY (invoice_id) REFERENCES platform_invoices(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Notifications queue log (emails sent by worker) — PDF §6 worker, §12 phase 4
CREATE TABLE notifications (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id      BIGINT UNSIGNED NULL,
  channel        ENUM('EMAIL','SMS','WHATSAPP','IN_APP') NOT NULL DEFAULT 'EMAIL',
  recipient_type ENUM('PLATFORM','USER','CUSTOMER','EMAIL') NOT NULL,
  recipient_id   BIGINT UNSIGNED NULL,
  recipient      VARCHAR(190) NOT NULL COMMENT 'email / phone',
  template       VARCHAR(60)  NOT NULL,
  subject        VARCHAR(255) NULL,
  payload        JSON         NULL,
  status         ENUM('QUEUED','SENT','FAILED') NOT NULL DEFAULT 'QUEUED',
  attempts       INT UNSIGNED NOT NULL DEFAULT 0,
  last_error     VARCHAR(500) NULL,
  is_read        TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'IN_APP only',
  sent_at        DATETIME(3)  NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_notifications_tenant_created (tenant_id, created_at),
  KEY ix_notifications_status (status, created_at),
  CONSTRAINT fk_notifications_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Financial-year-wise invoice number sequence (gap-free, row locked)
CREATE TABLE invoice_sequences (
  fy_label VARCHAR(9)      NOT NULL PRIMARY KEY COMMENT 'e.g. 2026-27',
  value    BIGINT UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
