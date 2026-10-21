-- =====================================================================
-- V7  REFERENCE DATA — plans, modules, global permissions, admin menus,
--     themes, platform settings.  (Super admin user is created by
--     `npm run seed:superadmin` so the password is never in SQL.)
-- =====================================================================

-- ---------- Modules -------------------------------------------------
INSERT INTO modules (code, name, description, is_core, is_addon, addon_price_monthly, sort_order) VALUES
 ('CATALOG',      'Products & Categories', 'Product catalogue',                         1, 0,   0, 10),
 ('ORDERS',       'Orders',                'Orders, COD & Razorpay checkout',           1, 0,   0, 20),
 ('CUSTOMERS',    'Customers',             'Customer accounts and order tracking',      1, 0,   0, 30),
 ('ACCESS',       'Staff, Roles & Menus',  'Dynamic roles, permissions, menus',         1, 0,   0, 40),
 ('THEME',        'Theme & Branding',      'Theme customisation, live preview',         1, 0,   0, 50),
 ('PAGE_BUILDER', 'Page & Form Builder',   'About / Gallery / Contact pages, forms',    0, 0,   0, 60),
 ('SEO',          'SEO',                   'Meta tags, sitemap.xml, robots.txt',        0, 0,   0, 70),
 ('COUPONS',      'Coupons',               'Discount coupons',                          0, 1, 149, 80),
 ('REPORTS',      'Reports',               'Sales and product reports',                 0, 1, 149, 90),
 ('CUSTOM_DOMAIN','Custom Domain',         'Connect your own domain (Pro and above)',   0, 0,   0, 100),
 ('BLOG',         'Blog',                  'Blog posts (add-on)',                       0, 1, 299, 110),
 ('BOOKING',      'Booking',               'Appointment / service booking (add-on)',    0, 1, 499, 120),
 ('HEADLESS_API', 'Headless API',          'API key access for your own website',       0, 0,   0, 130);

-- ---------- Plans (PDF §10: ₹499 / ₹999 / ₹1,999) ---------------------
INSERT INTO plans (code, name, description, price_monthly, price_yearly, trial_days, max_products, max_staff, max_storage_mb,
                   allow_custom_domain, allow_headless_api, transaction_fee_percent, sort_order) VALUES
 ('BASIC',    'Basic',    'Start selling online on yourname.myshop.com', 499.00,  4990.00, 14,  100,  2,   500, 0, 0, 1.00, 10),
 ('PRO',      'Pro',      'Custom domain, coupons and reports',          999.00,  9990.00, 14, 1000,  5,  2000, 1, 0, 0.00, 20),
 ('BUSINESS', 'Business', 'Unlimited products, headless API',           1999.00, 19990.00, 14, NULL, 15, 10000, 1, 1, 0.00, 30);

INSERT INTO plan_modules (plan_id, module_id)
SELECT p.id, m.id FROM plans p JOIN modules m
WHERE (p.code = 'BASIC'    AND m.code IN ('CATALOG','ORDERS','CUSTOMERS','ACCESS','THEME','PAGE_BUILDER','SEO'))
   OR (p.code = 'PRO'      AND m.code IN ('CATALOG','ORDERS','CUSTOMERS','ACCESS','THEME','PAGE_BUILDER','SEO','COUPONS','REPORTS','CUSTOM_DOMAIN'))
   OR (p.code = 'BUSINESS' AND m.code IN ('CATALOG','ORDERS','CUSTOMERS','ACCESS','THEME','PAGE_BUILDER','SEO','COUPONS','REPORTS','CUSTOM_DOMAIN','HEADLESS_API'));

-- ---------- Global permissions (PDF §5.1) -----------------------------
INSERT INTO permissions (code, name, group_name, module_code, sort_order) VALUES
 ('DASHBOARD_VIEW',          'View dashboard',              'Dashboard', NULL,           10),
 ('PRODUCT_VIEW',            'View products',               'Products',  'CATALOG',      20),
 ('PRODUCT_CREATE',          'Create products',             'Products',  'CATALOG',      21),
 ('PRODUCT_EDIT',            'Edit products',               'Products',  'CATALOG',      22),
 ('PRODUCT_DELETE',          'Delete / archive products',   'Products',  'CATALOG',      23),
 ('CATEGORY_MANAGE',         'Manage categories',           'Products',  'CATALOG',      24),
 ('MEDIA_UPLOAD',            'Upload images',               'Products',  'CATALOG',      25),
 ('ORDER_VIEW',              'View orders',                 'Orders',    'ORDERS',       30),
 ('ORDER_UPDATE',            'Update order status',         'Orders',    'ORDERS',       31),
 ('ORDER_CANCEL',            'Cancel orders',               'Orders',    'ORDERS',       32),
 ('CUSTOMER_VIEW',           'View customers',              'Customers', 'CUSTOMERS',    40),
 ('CUSTOMER_MANAGE',         'Block / edit customers',      'Customers', 'CUSTOMERS',    41),
 ('COUPON_MANAGE',           'Manage coupons',              'Marketing', 'COUPONS',      50),
 ('REPORT_VIEW',             'View reports',                'Reports',   'REPORTS',      60),
 ('STAFF_VIEW',              'View staff',                  'Team',      'ACCESS',       70),
 ('STAFF_MANAGE',            'Invite / edit staff',         'Team',      'ACCESS',       71),
 ('ROLE_MANAGE',             'Manage roles & permissions',  'Team',      'ACCESS',       72),
 ('MENU_MANAGE',             'Rename / hide / reorder menus','Design',   'ACCESS',       80),
 ('THEME_MANAGE',            'Theme & branding',            'Design',    'THEME',        81),
 ('PAGE_MANAGE',             'Manage pages',                'Content',   'PAGE_BUILDER', 90),
 ('FORM_MANAGE',             'Manage forms & submissions',  'Content',   'PAGE_BUILDER', 91),
 ('BLOG_MANAGE',             'Manage blog',                 'Content',   'BLOG',         92),
 ('BOOKING_MANAGE',          'Manage bookings',             'Content',   'BOOKING',      93),
 ('SETTINGS_MANAGE',         'Store settings & shipping',   'Settings',  NULL,          100),
 ('PAYMENT_SETTINGS_MANAGE', 'Razorpay keys & COD',         'Settings',  'ORDERS',      101),
 ('SEO_MANAGE',              'SEO settings',                'Settings',  'SEO',         102),
 ('DOMAIN_MANAGE',           'Custom domain',               'Settings',  'CUSTOM_DOMAIN',103),
 ('API_KEY_MANAGE',          'Headless API keys',           'Settings',  'HEADLESS_API',104),
 ('BILLING_MANAGE',          'Plan, invoices & add-ons',    'Billing',   NULL,          110),
 ('AUDIT_VIEW',              'View audit log',              'Billing',   NULL,          111);

-- ---------- Store Admin menu catalogue (PDF §5.2) ---------------------
INSERT INTO menu_templates (code, parent_id, default_label, icon, route, permission_code, module_code, default_sort) VALUES
 ('dashboard', NULL, 'Dashboard', 'dashboard', '/admin/dashboard', 'DASHBOARD_VIEW', NULL, 10);

INSERT INTO menu_templates (code, parent_id, default_label, icon, route, permission_code, module_code, default_sort) VALUES
 ('catalog', NULL, 'Catalog', 'inventory', '', NULL, 'CATALOG', 20);
SET @p := LAST_INSERT_ID();
INSERT INTO menu_templates (code, parent_id, default_label, icon, route, permission_code, module_code, default_sort) VALUES
 ('products',   @p, 'Products',   'inventory_2', '/admin/products',   'PRODUCT_VIEW',    'CATALOG', 21),
 ('categories', @p, 'Categories', 'category',    '/admin/categories', 'CATEGORY_MANAGE', 'CATALOG', 22);

INSERT INTO menu_templates (code, parent_id, default_label, icon, route, permission_code, module_code, default_sort) VALUES
 ('orders',    NULL, 'Orders',    'receipt_long', '/admin/orders',    'ORDER_VIEW',    'ORDERS',    30),
 ('customers', NULL, 'Customers', 'group',        '/admin/customers', 'CUSTOMER_VIEW', 'CUSTOMERS', 40),
 ('coupons',   NULL, 'Coupons',   'sell',         '/admin/coupons',   'COUPON_MANAGE', 'COUPONS',   50),
 ('reports',   NULL, 'Reports',   'bar_chart',    '/admin/reports',   'REPORT_VIEW',   'REPORTS',   60);

INSERT INTO menu_templates (code, parent_id, default_label, icon, route, permission_code, module_code, default_sort) VALUES
 ('content', NULL, 'Content', 'article', '', NULL, NULL, 70);
SET @p := LAST_INSERT_ID();
INSERT INTO menu_templates (code, parent_id, default_label, icon, route, permission_code, module_code, default_sort) VALUES
 ('pages',    @p, 'Pages',    'web',            '/admin/pages',    'PAGE_MANAGE',    'PAGE_BUILDER', 71),
 ('forms',    @p, 'Forms',    'dynamic_form',   '/admin/forms',    'FORM_MANAGE',    'PAGE_BUILDER', 72),
 ('blog',     @p, 'Blog',     'edit_note',      '/admin/blog',     'BLOG_MANAGE',    'BLOG',         73),
 ('bookings', @p, 'Bookings', 'event_available','/admin/bookings', 'BOOKING_MANAGE', 'BOOKING',      74);

INSERT INTO menu_templates (code, parent_id, default_label, icon, route, permission_code, module_code, default_sort) VALUES
 ('design', NULL, 'Design', 'palette', '', NULL, NULL, 80);
SET @p := LAST_INSERT_ID();
INSERT INTO menu_templates (code, parent_id, default_label, icon, route, permission_code, module_code, default_sort) VALUES
 ('theme', @p, 'Theme',  'brush', '/admin/theme', 'THEME_MANAGE', 'THEME',  81),
 ('menus', @p, 'Menus',  'menu',  '/admin/menus', 'MENU_MANAGE',  'ACCESS', 82);

INSERT INTO menu_templates (code, parent_id, default_label, icon, route, permission_code, module_code, default_sort) VALUES
 ('team', NULL, 'Team', 'badge', '', NULL, 'ACCESS', 90);
SET @p := LAST_INSERT_ID();
INSERT INTO menu_templates (code, parent_id, default_label, icon, route, permission_code, module_code, default_sort) VALUES
 ('staff', @p, 'Staff', 'person', '/admin/staff', 'STAFF_VIEW',  'ACCESS', 91),
 ('roles', @p, 'Roles', 'shield', '/admin/roles', 'ROLE_MANAGE', 'ACCESS', 92);

INSERT INTO menu_templates (code, parent_id, default_label, icon, route, permission_code, module_code, default_sort) VALUES
 ('settings', NULL, 'Settings', 'settings', '', NULL, NULL, 100);
SET @p := LAST_INSERT_ID();
INSERT INTO menu_templates (code, parent_id, default_label, icon, route, permission_code, module_code, default_sort) VALUES
 ('store-settings', @p, 'Store',    'store',   '/admin/settings/store',    'SETTINGS_MANAGE',         NULL,            101),
 ('payments',       @p, 'Payments', 'payments','/admin/settings/payments', 'PAYMENT_SETTINGS_MANAGE', 'ORDERS',        102),
 ('seo',            @p, 'SEO',      'travel_explore','/admin/settings/seo','SEO_MANAGE',              'SEO',           103),
 ('domains',        @p, 'Domain',   'language','/admin/settings/domains',  'DOMAIN_MANAGE',           'CUSTOM_DOMAIN', 104),
 ('api-keys',       @p, 'API Keys', 'key',     '/admin/settings/api-keys', 'API_KEY_MANAGE',          'HEADLESS_API',  105);

INSERT INTO menu_templates (code, parent_id, default_label, icon, route, permission_code, module_code, default_sort) VALUES
 ('billing', NULL, 'Billing',   'credit_card', '/admin/billing', 'BILLING_MANAGE', NULL, 110),
 ('audit',   NULL, 'Audit Log', 'history',     '/admin/audit',   'AUDIT_VIEW',     NULL, 120);

-- ---------- Themes (PDF §5.4 layer 1) --------------------------------
INSERT INTO themes (code, name, description, is_premium, price, default_settings, default_sections, sort_order) VALUES
 ('classic', 'Classic', 'Clean layout, top header, card grid', 0, 0,
  JSON_OBJECT('colors', JSON_OBJECT('primary','#1f6feb','secondary','#0f172a','background','#ffffff','surface','#f6f8fa','text','#1f2328','accent','#f59e0b'),
              'font','Inter','headingFont','Inter','logoUrl',NULL,'faviconUrl',NULL,'bannerUrl',NULL,'borderRadius',8,'productCardStyle','bordered'),
  JSON_ARRAY(
    JSON_OBJECT('id','hero','type','HERO_BANNER','enabled',true,'config',JSON_OBJECT('title','Welcome to our store','subtitle','Quality products at the best price','ctaText','Shop now','ctaLink','/products')),
    JSON_OBJECT('id','cats','type','CATEGORY_GRID','enabled',true,'config',JSON_OBJECT('title','Shop by category','limit',6)),
    JSON_OBJECT('id','feat','type','FEATURED_PRODUCTS','enabled',true,'config',JSON_OBJECT('title','Featured products','limit',8)),
    JSON_OBJECT('id','new','type','NEW_ARRIVALS','enabled',true,'config',JSON_OBJECT('title','New arrivals','limit',8))
  ), 10),
 ('modern', 'Modern', 'Bold hero, centred header, minimal cards', 0, 0,
  JSON_OBJECT('colors', JSON_OBJECT('primary','#7c3aed','secondary','#111827','background','#fafafa','surface','#ffffff','text','#111827','accent','#ec4899'),
              'font','Poppins','headingFont','Poppins','logoUrl',NULL,'faviconUrl',NULL,'bannerUrl',NULL,'borderRadius',16,'productCardStyle','minimal'),
  JSON_ARRAY(
    JSON_OBJECT('id','hero','type','HERO_BANNER','enabled',true,'config',JSON_OBJECT('title','New season, new style','subtitle','Discover our latest collection','ctaText','Explore','ctaLink','/products')),
    JSON_OBJECT('id','feat','type','FEATURED_PRODUCTS','enabled',true,'config',JSON_OBJECT('title','Trending now','limit',8)),
    JSON_OBJECT('id','text','type','RICH_TEXT','enabled',true,'config',JSON_OBJECT('html','<p>Handpicked products, delivered to your door.</p>'))
  ), 20),
 ('boutique', 'Boutique (Premium)', 'Elegant serif layout for fashion & textiles', 1, 2999.00,
  JSON_OBJECT('colors', JSON_OBJECT('primary','#9a3412','secondary','#1c1917','background','#fffbf5','surface','#ffffff','text','#1c1917','accent','#ca8a04'),
              'font','Lato','headingFont','Playfair Display','logoUrl',NULL,'faviconUrl',NULL,'bannerUrl',NULL,'borderRadius',2,'productCardStyle','overlay'),
  JSON_ARRAY(
    JSON_OBJECT('id','hero','type','HERO_BANNER','enabled',true,'config',JSON_OBJECT('title','Timeless elegance','subtitle','Handwoven collections','ctaText','View collection','ctaLink','/products')),
    JSON_OBJECT('id','cats','type','CATEGORY_GRID','enabled',true,'config',JSON_OBJECT('title','Collections','limit',4)),
    JSON_OBJECT('id','feat','type','FEATURED_PRODUCTS','enabled',true,'config',JSON_OBJECT('title','Bestsellers','limit',8))
  ), 30);

-- ---------- Platform settings ---------------------------------------
INSERT INTO platform_settings (setting_key, setting_value) VALUES
 ('company_name',      'TechLadder'),
 ('company_gstin',     ''),
 ('company_address',   ''),
 ('company_state_code','33'),
 ('gst_rate',          '18'),
 ('sac_code',          '998314'),
 ('invoice_prefix',    'MS'),
 ('grace_days',        '7'),
 ('setup_service_fee', '5000'),
 ('reserved_subdomains','www,admin,api,app,mail,static,cdn,stores,help,support,blog,status,docs,billing,dashboard');
