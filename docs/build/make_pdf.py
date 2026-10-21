"""Build docs/Multi_Tenant_Platform_Tamil_NodeJS.pdf (same content as v1, Node.js backend, + DB schema)."""
import json, html, sys
from weasyprint import HTML

SCHEMA = json.load(open(sys.argv[1]))
OUT = sys.argv[2]
e = html.escape

GROUPS = [
  ('A. Platform (global) tables — Super Admin-உடையவை, tenant_id இல்லை', [
    ('plans', 'Subscription plans – ₹499 / ₹999 / ₹1,999, limits, custom domain, 1% fee'),
    ('modules', 'On/off செய்யக்கூடிய modules, add-on விலை (Blog, Booking...)'),
    ('plan_modules', 'எந்த plan-ல் எந்த modules'),
    ('permissions', 'Global permission list (PRODUCT_CREATE, ORDER_VIEW...) — backend இவற்றை மட்டுமே சரிபார்க்கும்'),
    ('platform_users', 'Super Admin login (admin.myshop.com)'),
    ('themes', 'Layer 1 themes; owner_tenant_id = exclusive theme'),
    ('menu_templates', 'Store Admin menu catalogue (permission_code உடன்)'),
    ('platform_settings', 'GSTIN, state code, SAC, grace days, reserved subdomains'),
  ]),
  ('B. Tenant (client) அமைப்பு', [
    ('tenants', 'ஒவ்வொரு client / கடை; status: TRIAL, ACTIVE, PAST_DUE, SUSPENDED...'),
    ('tenant_domains', 'Host → tenant: subdomain + custom domain, CNAME verification'),
    ('tenant_settings', 'Client-இன் Razorpay keys (encrypted), COD, shipping, SEO'),
    ('tenant_limits', 'Super Admin limit override (NULL = plan default)'),
    ('tenant_modules', 'Module on/off per client (PLAN / ADDON / MANUAL)'),
    ('subscriptions', 'Platform subscription, period, grace, auto-renew'),
    ('tenant_counters', 'Per-client order number sequence (gap-free)'),
  ]),
  ('C. Access control — roles, permissions, menus, users', [
    ('users', 'Store Owner + Staff (is_owner = எல்லா அனுமதியும்)'),
    ('roles', 'Client-உடைய roles (இரண்டு கடைக்கும் "Store Manager" = வேறு rows)'),
    ('role_permissions', 'Role-க்கு tick செய்த permissions'),
    ('user_roles', 'Staff-க்கு ஒன்று அல்லது பல roles'),
    ('user_invitations', 'Email invite token (hash மட்டும்)'),
    ('tenant_menus', 'Menu rename / hide / drag & drop order'),
    ('refresh_tokens', 'Login refresh tokens (3 வகை login)'),
    ('password_resets', 'Password reset tokens'),
    ('impersonation_sessions', 'Super Admin "login as client" பதிவு'),
    ('audit_logs', 'யார், எப்போது, என்ன மாற்றினார் (impersonator உட்பட)'),
    ('api_keys', 'Headless API keys (hash மட்டும்)'),
  ]),
  ('D. Catalogue, customers, orders, payments', [
    ('categories', 'Product categories (parent/child)'),
    ('products', 'Products — price, MRP, stock, GST, HSN, SEO'),
    ('product_images', 'Product படங்கள் (CDN url)'),
    ('customers', 'ஒவ்வொரு கடைக்கும் தனி customers'),
    ('customer_addresses', 'Customer delivery addresses'),
    ('coupons', 'Discount coupons'),
    ('orders', 'Orders (address, totals snapshot) — பணம் client account-க்கு'),
    ('order_items', 'Order lines (product name/price snapshot)'),
    ('order_status_history', 'Order tracking timeline'),
    ('payments', 'Store payments (COD / client Razorpay)'),
    ('coupon_redemptions', 'Coupon பயன்பாடு பதிவு'),
    ('media_files', 'Uploaded files (storage limit கணக்கு)'),
  ]),
  ('E. Branding & content', [
    ('tenant_theme_settings', 'Layer 2 (settings JSON) + Layer 3 (sections JSON); DRAFT & PUBLISHED'),
    ('tenant_themes', 'வாங்கிய premium themes'),
    ('pages', 'Page builder pages (About, Gallery, Contact) — draft + published sections'),
    ('forms', 'Form builder'),
    ('form_submissions', 'Form submissions'),
    ('blog_posts', 'Blog add-on module'),
    ('booking_services', 'Booking add-on — services'),
    ('bookings', 'Booking add-on — appointments'),
  ]),
  ('F. Platform billing (உங்கள் வருமானம்) & notifications', [
    ('platform_invoices', 'GST invoices (CGST+SGST / IGST)'),
    ('platform_invoice_items', 'Invoice lines (SAC code, ref: plan / module / theme / service / fee)'),
    ('platform_payments', 'உங்கள் Razorpay account-க்கு வந்த பணம்'),
    ('transaction_fees', 'Basic plan 1% per order — அடுத்த invoice-ல் சேர்க்கப்படும்'),
    ('service_requests', 'Store setup ₹5,000 / custom design / custom module'),
    ('notifications', 'Worker அனுப்பும் emails பதிவு'),
    ('invoice_sequences', 'Financial year வாரியான invoice number'),
  ]),
]
assert sum(len(g[1]) for g in GROUPS) == len(SCHEMA), (sum(len(g[1]) for g in GROUPS), len(SCHEMA))

def table_html(name, purpose):
    t = SCHEMA[name]
    fk_by_col = {}
    for f in t['fks']:
        fk_by_col.setdefault(f['cols'].split(',')[-1], []).append(f)
    rows = []
    for c in t['cols']:
        notes = []
        if c['key'] == 'PRI': notes.append('<b>PK</b>')
        if c['extra'] and 'auto_increment' in c['extra']: notes.append('auto')
        for f in t['fks']:
            if c['name'] in f['cols'].split(','):
                notes.append(f"FK → {e(f['ref'])}" + (f" ({f['rule'].lower()})" if f['rule'] not in ('RESTRICT', 'NO ACTION') else ''))
        if c['default'] and c['default'] not in ('CURRENT_TIMESTAMP(3)',): notes.append(f"default {e(c['default'])}")
        rows.append(f"<tr><td><code>{e(c['name'])}</code></td><td>{e(c['type'])}{'' if c['null'] else ' <span class=nn>NOT NULL</span>'}</td><td>{' · '.join(dict.fromkeys(notes))}</td></tr>")
    idx = [f"{'UNIQUE ' if i['unique'] else ''}({e(i['cols'])})" for i in t['idx'] if i['name'] != 'PRIMARY']
    return f"""<div class="tbl"><h4><code>{e(name)}</code> <span>{e(purpose)}</span></h4>
      <table class="cols"><tr><th>Column</th><th>Type</th><th>Key / குறிப்பு</th></tr>{''.join(rows)}</table>
      {f'<p class="idx"><b>Indexes:</b> ' + ', '.join(idx) + '</p>' if idx else ''}</div>"""

schema_html = ''.join(f"<h3 class='grp'>{e(g)}</h3>" + ''.join(table_html(n, p) for n, p in items) for g, items in GROUPS)

CSS = """
@page { size: A4; margin: 18mm 16mm 18mm 16mm;
  @top-right { content: 'Multi-Tenant Store Platform'; font-size: 8pt; color: #999; }
  @bottom-center { content: counter(page) ' / ' counter(pages); font-size: 8pt; color: #999; } }
@page :first { @top-right { content: none; } }
body { font-family: 'Noto Sans Tamil', 'Noto Sans', sans-serif; font-size: 10pt; line-height: 1.6; color: #222; }
h1 { color: #8b1a3e; font-size: 22pt; line-height: 1.25; margin: 0 0 6pt; }
h2 { color: #8b1a3e; font-size: 14pt; border-bottom: 1px solid #e8dfe2; padding-bottom: 4pt; margin: 18pt 0 8pt; page-break-after: avoid; }
h3 { font-size: 11pt; margin: 12pt 0 6pt; page-break-after: avoid; }
.cover { border: 1px solid #e5e5e5; border-radius: 8pt; padding: 18pt 20pt; margin-bottom: 14pt; }
.cover .sub { color: #555; font-size: 11pt; } .cover .meta { color: #777; font-size: 9pt; margin-top: 8pt; }
code { font-family: 'Noto Sans Mono', monospace; font-size: 8.5pt; background: #f3f3f3; padding: 0 3pt; border-radius: 3pt; }
.key { background: #f8eef1; border-left: 4pt solid #8b1a3e; padding: 8pt 12pt; border-radius: 3pt; margin: 10pt 0; }
.new { background: #eef6ff; border-left: 4pt solid #2563eb; padding: 8pt 12pt; border-radius: 3pt; margin: 10pt 0; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 9pt; }
th { background: #f8eef1; color: #8b1a3e; text-align: left; padding: 6pt; }
td { border-bottom: 1px solid #eee; padding: 6pt; vertical-align: top; }
ol.flow { list-style: none; padding: 0; counter-reset: s; } ol.flow li { counter-increment: s; position: relative; padding-left: 26pt; margin-bottom: 7pt; }
ol.flow li::before { content: counter(s); position: absolute; left: 0; top: 1pt; background: #8b1a3e; color: #fff; border-radius: 50%; width: 15pt; height: 15pt; text-align: center; font-size: 8pt; line-height: 15pt; font-weight: bold; }
pre { background: #f6f6f6; border: 1px solid #e8e8e8; border-radius: 4pt; padding: 10pt; font-family: 'Noto Sans Mono', 'Noto Sans Tamil', monospace; font-size: 8pt; line-height: 1.45; white-space: pre-wrap; page-break-inside: avoid; }
.changed { background: #fff6d6; }
.tbl { page-break-inside: avoid; margin-bottom: 8pt; }
.tbl h4 { margin: 8pt 0 2pt; font-size: 9.5pt; } .tbl h4 span { font-weight: normal; color: #555; font-size: 8.5pt; }
table.cols { font-size: 7.6pt; margin: 2pt 0; table-layout: fixed; line-height: 1.3; } table.cols td, table.cols th { padding: 1.6pt 4pt; }
table.cols td:nth-child(1), table.cols th:nth-child(1) { width: 28%; } table.cols td:nth-child(2), table.cols th:nth-child(2) { width: 30%; } table.cols code { font-size: 7.4pt; background: none; padding: 0; }
.nn { color: #8b1a3e; font-size: 6.8pt; } .idx { font-size: 7.4pt; color: #444; margin: 2pt 0 0; }
h3.grp { color: #8b1a3e; border-bottom: 1px dashed #d9c2ca; padding-bottom: 3pt; margin-top: 16pt; }
.pb { page-break-before: always; }
"""

C = lambda s: f'<span class="changed">{s}</span>'  # highlights Node.js changes

BODY = f"""
<div class="cover">
  <h1>Multi-Tenant Store Platform<br/>திட்டத்தின் முழு விளக்கம்</h1>
  <div class="sub">Angular + {C('Node.js')} + MySQL அடிப்படையிலான Multi-Organization SaaS Shopping Platform</div>
  <div class="meta">தயாரித்தவர்: பிரதாப் · தேதி: 20 அக்டோபர் 2026 · Version 2.0 ({C('Spring Boot → Node.js')})</div>
</div>
<div class="new"><b>Version 2.0-ல் என்ன மாற்றம்?</b> Version 1.0-ல் இருந்த எல்லா வரிகளும் அப்படியே உள்ளன. Backend மட்டும் <b>Spring Boot-க்கு பதிலாக Node.js (Express + TypeScript)</b>. மாற்றப்பட்ட இடங்கள் <span class="changed">மஞ்சள்</span> நிறத்தில் உள்ளன. புதிதாக: பகுதி 13 (Spring Boot → Node.js), பகுதி 14 (Database முழு வடிவமைப்பு – 53 tables), பகுதி 15 (Code folder &amp; run செய்வது).</div>

<h2>1. இந்த project என்ன?</h2>
<p>ஒரே application-ஐ வைத்து, <b>பல கடைக்காரர்களுக்கு (clients) தனித்தனி online shopping website-களை வாடகைக்கு கொடுப்பது</b> தான் இந்த project. இது Shopify மாதிரியான ஒரு <b>SaaS business</b>.</p>
<ul>
<li>நீங்கள் தான் <b>Super Admin</b>, அதாவது முழு platform-இன் உரிமையாளர்.</li>
<li>ஒவ்வொரு client-க்கும் <b>சொந்த website, சொந்த admin panel, சொந்த design</b> கிடைக்கும்.</li>
<li>ஆனால் code, server, database எல்லாமே <b>ஒன்றுதான்</b>.</li>
</ul>
<div class="key"><b>முக்கிய கருத்து:</b> ஒரே code, ஒரே build, ஒரே database. ஒவ்வொரு client-க்கும் உள்ள வேறுபாடுகள் (domain, theme, menu, role, features) அனைத்தும் database-ல் configuration-ஆக இருக்கும்.</div>

<h2>2. Domain எப்படி வேலை செய்யும்?</h2>
<p>நீங்கள் <b>ஒரே ஒரு domain</b> மட்டும் வாங்கினால் போதும், உதாரணமாக <code>myshop.com</code>.</p>
<table><tr><th>Domain</th><th>யாருக்கு / எதற்கு</th></tr>
<tr><td><code>myshop.com</code></td><td>உங்கள் சொந்த website (features, plans, signup)</td></tr>
<tr><td><code>admin.myshop.com</code></td><td>உங்கள் Super Admin panel</td></tr>
<tr><td><code>kavya.myshop.com</code></td><td>Client-இன் கடை (subdomain)</td></tr>
<tr><td><code>kavyatextiles.com</code></td><td>Client சொந்தமாக வாங்கிய domain-ஐயும் இணைக்கலாம் (custom domain)</td></tr></table>
<ul>
<li><b>Wildcard DNS</b> (<code>*.myshop.com</code>) மற்றும் <b>wildcard SSL</b> இருப்பதால், புதிய client வந்தால் DNS-ல் எதையும் மாற்ற வேண்டியதில்லை. Database-ல் ஒரு row சேர்த்தாலே website உடனே live ஆகிவிடும்.</li>
<li><b>Custom domain:</b> Client தன் domain-ல் ஒரு CNAME record சேர்க்க வேண்டும். System அதை verify செய்த பிறகு <b>Caddy</b> தானாக SSL certificate வழங்கும்.</li>
</ul>

<h2>3. உண்மையான flow (படிப்படியாக)</h2>
<ol class="flow">
<li><b>Client உங்களை கண்டுபிடிக்கிறார்.</b> "கவ்யா டெக்ஸ்டைல்ஸ்" உரிமையாளர் <code>myshop.com</code>-க்கு வந்து plan-களை பார்க்கிறார்.</li>
<li><b>Signup செய்கிறார்.</b> கடை பெயர், email, mobile கொடுத்து <code>kavya.myshop.com</code> என்ற subdomain-ஐ தேர்வு செய்து, plan-க்கு பணம் கட்டுகிறார் (அல்லது free trial).</li>
<li><b>System தானாகவே கடையை உருவாக்குகிறது.</b> Owner account, default roles, menus, theme, settings எல்லாம் தயாராகிவிடும்.</li>
<li><b>Client தன் கடையை setup செய்கிறார்.</b> Theme தேர்வு, logo மற்றும் நிறங்கள், products, categories, Razorpay keys, shipping கட்டணம்.</li>
<li><b>Staff-களை சேர்க்கிறார்.</b> "Store Manager", "Billing Staff" போன்ற <b>roles-ஐ அவரே உருவாக்கி</b>, எந்த role-க்கு என்ன அனுமதி என்பதை tick செய்கிறார்.</li>
<li><b>சொந்த domain இணைக்கிறார் (விருப்பம்).</b> <code>kavyatextiles.com</code>-ல் CNAME record சேர்த்தால் போதும்.</li>
<li><b>Staff தினசரி வேலை செய்கிறார்கள்.</b> Billing Staff-க்கு Orders மெனு மட்டுமே தெரியும்; Store Manager-க்கு Products, Orders, Reports தெரியும்.</li>
<li><b>வாடிக்கையாளர்கள் வாங்குகிறார்கள்.</b> அவர்கள் கவ்யாவின் design, logo, products மட்டுமே பார்ப்பார்கள். பணம் <b>நேரடியாக கவ்யாவின் account-க்கு</b> போகும்.</li>
<li><b>நீங்கள் எல்லாவற்றையும் கட்டுப்படுத்துகிறீர்கள்.</b> Client plan, module on/off, limits, subscription status பார்த்து, பணம் கட்டாவிட்டால் கடையை தற்காலிகமாக நிறுத்தலாம்.</li>
</ol>

<h2>4. நான்கு வகை users</h2>
<table><tr><th>User</th><th>எங்கே login</th><th>வேலை</th></tr>
<tr><td><b>Super Admin (நீங்கள்)</b></td><td><code>admin.myshop.com</code></td><td>எல்லா client-களையும், plans, themes, permissions, subscriptions-ஐயும் நிர்வகிப்பது</td></tr>
<tr><td><b>Store Owner (Client)</b></td><td><code>kavya.myshop.com/admin</code></td><td>தன் கடை, products, staff, roles, menus, design-ஐ நிர்வகிப்பது</td></tr>
<tr><td><b>Staff</b></td><td><code>kavya.myshop.com/admin</code></td><td>தனக்கு கொடுக்கப்பட்ட அனுமதி மட்டும் (உதா: orders மட்டும்)</td></tr>
<tr><td><b>Customer</b></td><td><code>kavya.myshop.com</code></td><td>பொருட்களை பார்த்து வாங்குவது, order track செய்வது</td></tr></table>

<h2 class="pb">5. எல்லாமே Dynamic</h2>
<h3>5.1 Roles மற்றும் Permissions</h3>
<ul>
<li><b>Permissions list உங்களுடையது</b> (global): <code>PRODUCT_CREATE</code>, <code>ORDER_VIEW</code> போன்றவை. Backend code இவற்றை மட்டுமே சரிபார்க்கும்.</li>
<li><b>Roles client-உடையது:</b> Client permission checkbox-களை tick செய்து, எத்தனை role வேண்டுமானாலும் உருவாக்கலாம்.</li>
<li>இரண்டு client-களுக்கும் "Store Manager" என்ற role இருக்கலாம். அவை வேறு வேறு rows, வேறு அனுமதிகள்.</li>
<li>{C("Node.js <code>requirePermission('ORDER_VIEW')</code> middleware மூலம் சரிபார்க்கும் (Spring Boot <code>@PreAuthorize(\"hasAuthority('ORDER_VIEW')\")</code>-க்கு சமம்).")} Role பெயர் முக்கியமில்லை, permission மட்டுமே முக்கியம். அதனால் புதிய role-க்கு code மாற்றம் தேவையில்லை.</li>
</ul>
<h3>5.2 Menus</h3>
<ul><li>ஒருவருக்கு எந்த permission இருக்கிறதோ, அந்த menu மட்டுமே <code>GET /api/me/menus</code>-ல் வரும்.</li>
<li>Client menu-வின் பெயரை மாற்றலாம், மறைக்கலாம், drag &amp; drop மூலம் வரிசையை மாற்றலாம்.</li></ul>
<h3>5.3 Users</h3>
<p>Client staff-ஐ email மூலம் invite செய்து, ஒன்று அல்லது பல roles கொடுக்கலாம். Plan-க்கு ஏற்ப staff எண்ணிக்கைக்கு limit இருக்கும்.</p>
<h3>5.4 Theme</h3>
<table><tr><th>அடுக்கு</th><th>என்ன மாறும்</th><th>யார் செய்வது</th></tr>
<tr><td><b>1. Theme</b></td><td>Layout, header, product card style (Angular components)</td><td>நீங்கள் (developer)</td></tr>
<tr><td><b>2. Customization</b></td><td>நிறம், font, logo, banner, border radius (database-ல் JSON)</td><td>Client, admin panel மூலம்</td></tr>
<tr><td><b>3. Page sections</b></td><td>Home page-ல் எந்த block, எந்த வரிசையில்</td><td>Client, drag &amp; drop மூலம்</td></tr></table>
<p>Angular app தொடங்கும் போது <code>/api/public/storefront-config</code>-ஐ அழைத்து theme settings-ஐ பெறும். நிறங்கள் <b>CSS variables</b> மூலம் மாற்றப்படும்; layout theme code மூலம் lazy-load ஆகும். Client live preview பார்த்து <b>Draft → Publish</b> செய்யலாம்.</p>

<h2>6. System Architecture</h2>
<pre>Browser (myshop.com / admin / kavya.myshop.com / kavyatextiles.com)
        │
        ▼
Caddy reverse proxy ── Wildcard SSL + custom domain-க்கு தானியங்கி SSL
        │
        ├──► Angular apps (ஒரே build: Storefront, Store Admin, Super Admin)
        │
        └──► /api/**  {C('Node.js API — Express + TypeScript')} (1..N instances)
                 │   TenantFilter: Host header → tenant_id   {C('(tenant middleware)')}
                 │   JwtFilter: token tenant = host tenant    {C('(requireAuth)')}
                 │   {C('requirePermission()')} permission check
                 │   {C('Tenant-scoped query (tq): ஒவ்வொரு query-க்கும் tenant filter')}
                 ▼
         MySQL 8   ·   Redis cache   ·   Object storage (images)
         Worker {C('(BullMQ)')} (emails, DNS checks, renewals)</pre>
<div class="key"><b>பாதுகாப்பு:</b> Token-ல் உள்ள <code>tenantId</code>-ம், domain மூலம் கண்டறிந்த tenant-ம் ஒன்றாக இல்லையென்றால் request நிராகரிக்கப்படும். இதனால் கடை A-வின் user, கடை B-வின் data-வை பார்க்க முடியாது. {C('கூடுதலாக, database-லேயே (tenant_id, id) composite foreign keys இருப்பதால் கடை A-வின் role-ஐ கடை B-வின் user-க்கு கொடுக்கவே முடியாது.')}</div>

<h2>7. 100+ clients வந்தால் எப்படி நிர்வகிப்பது?</h2>
<ul>
<li><b>UI ஒன்றுதான், API ஒன்றுதான்.</b> ஒவ்வொரு client-க்கும் தனி app கிடையாது.</li>
<li>Request வரும்போது <b>domain-ஐ பார்த்து எந்த client என்று கண்டுபிடிக்கப்படும்</b>.</li>
<li>எல்லா client-களின் data-வும் <b>ஒரே table-ல் <code>tenant_id</code> column-உடன்</b> இருக்கும்.</li>
<li>Traffic அதிகமானால் அதே API-ஐ 2, 3 copies-ஆக load balancer பின்னால் ஓட்டலாம் (horizontal scaling). இதற்கு API <b>stateless</b>-ஆக இருக்க வேண்டும் (JWT, Redis, object storage).</li>
<li>ஒரு bug-ஐ ஒரு முறை fix செய்தால் எல்லா client-களுக்கும் உடனே சரியாகிவிடும்.</li>
</ul>
<table><tr><th>நிலை</th><th>Clients</th><th>Setup</th><th>மாத செலவு (தோராயமாக)</th></tr>
<tr><td>தொடக்கம்</td><td>1–50</td><td>1 VPS, Docker Compose-ல் எல்லாமே</td><td>₹1,000–2,000</td></tr>
<tr><td>வளர்ச்சி</td><td>50–300</td><td>App server + தனி DB server + Redis, 2 API instances</td><td>₹4,000–8,000</td></tr>
<tr><td>பெரிய அளவு</td><td>300+</td><td>Load balancer, 3+ API, managed MySQL + read replica, CDN</td><td>வருமானத்துக்கு ஏற்ப</td></tr></table>

<h2>8. Speed எப்படி கிடைக்கும்?</h2>
<ul>
<li>100 கடை × 100 products = 10,000 rows மட்டுமே. MySQL-க்கு இது மிக சிறியது; லட்சக்கணக்கான rows-ஐயும் சுலபமாக கையாளும்.</li>
<li><b>Index எப்போதும் <code>tenant_id</code>-இல் தொடங்க வேண்டும்</b>, உதா: <code>(tenant_id, status, created_at)</code>. அப்போது MySQL மற்ற கடைகளின் data-வை படிக்காமல் நேரடியாக அந்த client data-வுக்கு செல்லும்.</li>
<li><b>Pagination:</b> Admin பக்கங்களுக்கு <b>offset</b> (page numbers, total count); storefront scroll, logs, APIs-க்கு <b>cursor (keyset)</b>.</li>
<li><b>Redis cache:</b> Domain lookup, theme, menus, permissions, rate limit counters. ஒவ்வொரு request-க்கும் database-ஐ தொட வேண்டியதில்லை.</li>
<li>N+1 queries தவிர்க்க {C('தேவையான columns மட்டும் select, JOIN, batch loading (ஒரே query-ல் எல்லா product images) பயன்படுத்தவும் (Spring-ல் DTO projection, JOIN FETCH-க்கு சமம்).')}</li>
</ul>
<div class="key">Slowness மொத்த rows எண்ணிக்கையால் வருவதில்லை. <b>Index இல்லாதது, pagination இல்லாதது, N+1 queries</b> ஆகிய மூன்றால் தான் வருகிறது.</div>

<h2>9. Client தனி design அல்லது shopping இல்லாத பக்கங்கள் கேட்டால்?</h2>
<p><b>Code-ஐ ஒருபோதும் fork செய்யக்கூடாது, <code>if (client == kavya)</code> என்றும் எழுதக்கூடாது.</b> அதற்கு பதிலாக நான்கு நிலைகள்:</p>
<table><tr><th>Client கேட்பது</th><th>தீர்வு</th><th>கட்டணம்</th></tr>
<tr><td>About, Gallery, Contact பக்கங்கள்</td><td><b>Page builder</b> – section blocks மூலம் client தானே செய்யலாம்; form builder-உடன்</td><td>Plan-ல் அடங்கும்</td></tr>
<tr><td>தனித்துவமான design</td><td>அவருக்கு மட்டுமான <b>exclusive theme</b> (அதே codebase, <code>owner_tenant_id</code>)</td><td>ஒருமுறை கட்டணம்</td></tr>
<tr><td>Booking, Blog போன்ற feature</td><td>தனி <b>module</b>, அவருக்கு மட்டும் <code>tenant_modules</code>-ல் on</td><td>மாத add-on கட்டணம்</td></tr>
<tr><td>தனி website வேண்டும்</td><td><code>shop.theirdomain.com</code> அல்லது <b>headless API</b> (API key)</td><td>உயர் plan</td></tr></table>
<p>ஒரு client-க்காக செய்யும் custom வேலையை generic-ஆக செய்தால், அதை பின்னர் மற்ற client-களுக்கும் add-on-ஆக விற்கலாம்.</p>

<h2>10. வருமானம் எப்படி?</h2>
<table><tr><th>வருமான வழி</th><th>உதாரணம்</th></tr>
<tr><td>மாத / வருட subscription</td><td>₹499 / ₹999 / ₹1,999 மாதம்</td></tr>
<tr><td>Custom domain feature</td><td>Pro plan மற்றும் அதற்கு மேல் மட்டும்</td></tr>
<tr><td>Premium themes</td><td>ஒருமுறை வாங்குதல்</td></tr>
<tr><td>Store setup சேவை</td><td>Technical தெரியாத client-களுக்கு ₹5,000</td></tr>
<tr><td>Custom design / module</td><td>Design கட்டணம் + மாத add-on</td></tr>
<tr><td>Transaction fee (விருப்பம்)</td><td>Basic plan-ல் ஒவ்வொரு order-க்கும் 1%</td></tr></table>

<h2>11. Technology Stack</h2>
<table><tr><th>பகுதி</th><th>Technology</th></tr>
<tr><td>Frontend</td><td>Angular {C('20')} (Storefront, Store Admin, Super Admin) – shared library</td></tr>
<tr><td>Backend</td><td>{C('Node.js 22, Express 5, TypeScript, JWT + permission middleware, Knex tenant-scoped repository (Hibernate @TenantId-க்கு சமம்)')}</td></tr>
<tr><td>Database</td><td>MySQL 8, {C('versioned SQL migrations (Flyway முறை: V1__…sql, checksum சரிபார்ப்பு)')}</td></tr>
<tr><td>Cache</td><td>Redis + {C('lru-cache (Caffeine-க்கு சமம்)')}</td></tr>
<tr><td>Background worker</td><td>{C('BullMQ (Redis) — emails, DNS checks, renewals')}</td></tr>
<tr><td>Proxy / SSL</td><td>Caddy (on-demand TLS) + Cloudflare DNS</td></tr>
<tr><td>Storage</td><td>S3-compatible object storage + CDN</td></tr>
<tr><td>Payments</td><td>Razorpay (client-க்கு சொந்த keys; platform billing-க்கு உங்கள் account)</td></tr>
<tr><td>Deployment</td><td>Docker Compose, GitHub Actions CI/CD</td></tr></table>

<h2>12. Build செய்யும் வரிசை (Phases)</h2>
<table><tr><th>Phase</th><th>என்ன செய்வது</th><th>முடிந்ததற்கான அடையாளம் (Gate)</th></tr>
<tr><td><b>1. MVP</b></td><td>Tenant உருவாக்கம், subdomain, wildcard SSL, products, orders, COD + Razorpay, ஒரு theme</td><td>ஒரு pilot கடை உண்மையான paid order பெறுகிறது</td></tr>
<tr><td><b>2. Access control</b></td><td>Dynamic roles, permissions, staff, menus, audit log</td><td>Staff-க்கு அனுமதிக்கப்பட்ட menu, API மட்டுமே</td></tr>
<tr><td><b>3. Branding</b></td><td>Theme customization, live preview, custom domain</td><td>Developer உதவியின்றி client domain இணைத்து theme publish</td></tr>
<tr><td><b>4. Self-service</b></td><td>Self-signup, plans, auto-renewal, GST invoices, notifications</td><td>புதிய client manual வேலையின்றி live ஆகிறார்</td></tr>
<tr><td><b>5. Growth</b></td><td>Reports, coupons, page builder, SEO, impersonation</td><td>100 client-களை ஏற்க தயார்</td></tr></table>
<div class="key"><b>சுருக்கமாக:</b> ஒரே code, ஒரே build, ஒரே database. ஒவ்வொரு client-க்கும் உள்ள வேறுபாடுகள் அனைத்தும் database-ல் configuration-ஆக இருக்கும். இதுவே 100 அல்லது 1,000 client-களையும் சுலபமாக நிர்வகிக்கும் ரகசியம்.</div>
<div class="new"><b>Code நிலை:</b> 5 phases-ம் code-ல் உள்ளன. 25 end-to-end tests ஒவ்வொரு gate-ஐயும் சரிபார்க்கின்றன (signup → live store, tenant isolation, staff menus, COD order, theme publish, custom domain, suspend, renewal + GST invoice, impersonation, headless API, reports/SEO, coupons) — எல்லாம் pass.</div>

<h2 class="pb">13. Spring Boot → Node.js மாற்றம் (புதிது)</h2>
<table><tr><th>Spring Boot (v1.0)</th><th>Node.js (v2.0)</th><th>File</th></tr>
<tr><td>Java 21, Spring Boot 3</td><td>Node.js 22, Express 5, TypeScript 5</td><td><code>backend/</code></td></tr>
<tr><td>Spring Security (login, JWT)</td><td>bcrypt passwords, JWT access token + rotating refresh token, rate limiting</td><td><code>lib/jwt.ts</code>, <code>middleware/auth.ts</code></td></tr>
<tr><td>TenantFilter</td><td>Host header → tenant; AsyncLocalStorage request context</td><td><code>middleware/tenant.ts</code></td></tr>
<tr><td>JwtFilter</td><td><code>requireAuth()</code> — token tid ≠ host tenant → 403 TENANT_MISMATCH</td><td><code>middleware/auth.ts</code></td></tr>
<tr><td><code>@PreAuthorize("hasAuthority('X')")</code></td><td><code>requirePermission('X')</code></td><td><code>middleware/auth.ts</code></td></tr>
<tr><td>Hibernate 6 <code>@TenantId</code></td><td><code>tq('products')</code> தானாக <code>WHERE tenant_id = ?</code> சேர்க்கும்; <code>tinsert()</code> tenant_id-ஐ context-லிருந்து போடும்; dev-ல் tenant guard எச்சரிக்கை</td><td><code>db/tenant-scope.ts</code></td></tr>
<tr><td>Spring Data JPA repositories</td><td>Knex query builder + mysql2</td><td><code>db/knex.ts</code></td></tr>
<tr><td>Flyway</td><td><code>npm run migrate</code> (V1…V7 SQL, checksum + lock)</td><td><code>db/migrate.ts</code></td></tr>
<tr><td>Caffeine + Redis</td><td>lru-cache (L1) + Redis (L2), pub/sub மூலம் எல்லா instance-களிலும் cache clear</td><td><code>cache/cache.ts</code></td></tr>
<tr><td>@Scheduled / worker</td><td>BullMQ repeatable jobs: renewals (தினமும் 2:30 AM IST), DNS check (10 நிமிடம்), emails</td><td><code>worker.ts</code></td></tr>
<tr><td>Bean Validation</td><td>zod schemas</td><td><code>middleware/common.ts</code></td></tr></table>

<h2>14. Database முழு வடிவமைப்பு (புதிது)</h2>
<div class="key"><b>Database விதிகள் (சரியான DB-க்கு):</b>
<ul>
<li>MySQL 8, InnoDB, <code>utf8mb4</code> (தமிழ் எழுத்துக்கள் சரியாக சேமிக்கப்படும்). மொத்தம் <b>53 tables</b>, 7 migration files.</li>
<li>Client data உள்ள ஒவ்வொரு table-லும் <code>tenant_id NOT NULL</code>; <b>எல்லா index-ம் <code>tenant_id</code>-இல் தொடங்கும்</b> (பகுதி 8).</li>
<li>Tenant tables-ல் <code>UNIQUE (tenant_id, id)</code> + <b>composite foreign keys</b> — DB-யே cross-tenant link-ஐ தடுக்கும்.</li>
<li>Slug, SKU, email, coupon code, order number — <b>ஒரு கடைக்குள் மட்டும் unique</b> (<code>UNIQUE (tenant_id, …)</code>).</li>
<li>பணம் <code>DECIMAL(12,2)</code>; நேரம் <code>DATETIME(3)</code> UTC; GST rate <code>DECIMAL(5,2)</code>; CHECK constraints (price ≥ 0, qty &gt; 0).</li>
<li>Order item-ல் product பெயர், விலை, GST snapshot — product மாறினாலும் பழைய order மாறாது. Order உள்ள product delete ஆகாது, ARCHIVED ஆகும்.</li>
<li>Client Razorpay secret AES-256-GCM encrypted; tokens/API keys SHA-256 hash மட்டும் சேமிக்கப்படும்.</li>
<li>Order number ஒவ்வொரு கடைக்கும் தனி வரிசை (<code>tenant_counters</code>, row lock); GST invoice number financial year வாரியாக (<code>invoice_sequences</code>).</li>
</ul></div>
{schema_html}

<h2 class="pb">15. Code folder &amp; run செய்வது (புதிது)</h2>
<pre>myshop-platform/
├─ database/migrations/   V1…V7 SQL (53 tables)
├─ backend/               Node.js API + Worker (Express, TypeScript)
│   └─ test/e2e.test.ts   25 tests — PDF-இன் ஒவ்வொரு பகுதிக்கும்
├─ frontend/              Angular 20 — ஒரே build (4 surfaces)
├─ deploy/                Caddyfile, Dockerfiles, .env.example
├─ docker-compose.yml     Stage 1: ஒரு VPS
├─ .github/workflows/     CI/CD
└─ COVERAGE.md            PDF-இன் ஒவ்வொரு வரி → code இடம்</pre>
<p><b>Windows-ல் (VS Code + PowerShell):</b></p>
<pre>cd backend;  copy .env.example .env;  npm install
npm run migrate
npm run seed:superadmin -- admin@myshop.test "SuperAdmin@123" "KK"
npm run seed:demo          # Kavya Textiles demo கடை
npm run dev                # API :3000      (இன்னொரு terminal: npm run dev:worker)
cd ..\\frontend;  npm install;  npx ng serve     # :4200</pre>
<table><tr><th>URL (dev)</th><th>என்ன</th></tr>
<tr><td><code>http://localhost:4200</code></td><td>உங்கள் website + signup</td></tr>
<tr><td><code>http://admin.localhost:4200</code></td><td>Super Admin</td></tr>
<tr><td><code>http://kavya.localhost:4200</code></td><td>Kavya கடை (owner@kavya.test / Password@123)</td></tr>
<tr><td><code>http://kavya.localhost:4200/admin</code></td><td>Kavya Store Admin</td></tr></table>
<p><b>Production:</b> <code>docker compose --env-file deploy/.env up -d --build</code> → <code>docker compose run --rm migrate</code>. Traffic அதிகமானால் <code>--scale api=3</code>.</p>
<p><b>Live-க்கு முன் உறுதி செய்ய:</b> SAC code (default 998314) மற்றும் உங்கள் GSTIN — உங்கள் CA-விடம் உறுதி செய்து Super Admin → Settings-ல் மாற்றவும்.</p>
"""

HTML(string=f"<html><head><meta charset='utf-8'><style>{CSS}</style></head><body>{BODY}</body></html>").write_pdf(OUT)
print('written', OUT)
