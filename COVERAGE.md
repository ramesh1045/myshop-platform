# PDF → implementation coverage (every line)

Legend: **DB** = `database/migrations`, **API** = `backend/src`, **UI** = `frontend/src/app`, **T#** = test number in `backend/test/e2e.test.ts` (all 25 pass).

## §1 இந்த project என்ன?
| PDF line | Implementation |
|---|---|
| One application renting separate shopping websites to many clients (Shopify-like SaaS) | Whole repo; tenants table (DB V2) |
| You are the Super Admin (platform owner) | `platform_users` (DB V1), `admin.<domain>` → `routes/platform`, UI `super-admin/` |
| Each client gets own website, own admin panel, own design | Storefront `UI storefront/`, Store admin `UI store-admin/`, theme `tenant_theme_settings` |
| But code, server, database are one | Single API + single Angular build + single MySQL schema with `tenant_id` |
| Key idea: one code/build/DB; domain, theme, menu, role, features are DB configuration | `tenant_domains`, `tenant_theme_settings`, `tenant_menus`, `roles`/`role_permissions`, `tenant_modules` |

## §2 Domain
| PDF line | Implementation |
|---|---|
| Buy only one domain (myshop.com) | `PLATFORM_DOMAIN` env (API) + `environment.platformDomain` (UI) |
| myshop.com = your website (features, plans, signup) | `UI marketing/marketing.routes.ts`, `API routes/public/signup.routes.ts` |
| admin.myshop.com = Super Admin panel | `UI super-admin/`, `API /api/platform` (`onlySurface('PLATFORM_ADMIN')`) |
| kavya.myshop.com = client's shop (subdomain) | `tenant_domains` type SUBDOMAIN, `middleware/tenant.ts`; T2 |
| kavyatextiles.com = client's own domain | `tenant_domains` type CUSTOM; `routes/admin/settings.routes.ts` /domains; T18 |
| Wildcard DNS + wildcard SSL → new client needs no DNS change; one DB row → live | `deploy/Caddyfile` `*.{$PLATFORM_DOMAIN}` + Cloudflare DNS; `provisioning.service.ts` inserts the row; T2 |
| Custom domain: client adds CNAME, system verifies, Caddy issues SSL automatically | `services/domain.service.ts` (dns.resolveCname, worker every 10 min), `/api/internal/domain-check` (Caddy `on_demand_tls ask`); T18 |

## §3 Flow (steps 1–9)
| Step | Implementation |
|---|---|
| 1 Client finds you, sees plans on myshop.com | `UI marketing` Pricing page, `GET /api/signup/plans`; T1 |
| 2 Signup: shop name, email, mobile, choose subdomain, pay or free trial | `UI SignupPage` (live subdomain check), `POST /api/signup`, Razorpay for paid; T1, T2 |
| 3 System auto-creates owner account, default roles, menus, theme, settings | `provisioning.service.ts` (one transaction); T2 asserts roles + menus |
| 4 Client sets up: theme, logo & colours, products, categories, Razorpay keys, shipping fee | `ThemePage`, `ProductFormPage`, `CategoriesPage`, `PaymentSettingsPage`, `StoreSettingsPage`; T7, T15 |
| 5 Adds staff; creates roles like "Store Manager", "Billing Staff"; ticks permissions | `RolesPage`, `StaffPage`; `DEFAULT_ROLES`; T9 |
| 6 Connects own domain (optional) via CNAME | `DomainsPage`; T18 |
| 7 Billing Staff sees only Orders; Store Manager sees Products, Orders, Reports | `DEFAULT_ROLES` permission sets + `/api/me/menus`; T9 asserts menus = `['orders']` |
| 8 Customers see only Kavya's design/logo/products; money goes directly to Kavya's account | storefront-config per host; checkout uses tenant's own Razorpay keys (`order.service.ts`); T7, T13 |
| 9 You control client plan, module on/off, limits, subscription status; suspend unpaid shop | `PfTenantDetail` + `/api/platform/tenants/:id/{plan,modules,limits,suspend,resume}`; renewal job auto-suspends; T19, T20, T22 |

## §4 Four user types
| User | Implementation |
|---|---|
| Super Admin @ admin.myshop.com — manages all clients, plans, themes, permissions, subscriptions | `platform_users`; PfTenants, PfPlans, PfThemes, PfPermissions, PfSubscriptions |
| Store Owner @ kavya.myshop.com/admin — shop, products, staff, roles, menus, design | `users.is_owner=1` (implicitly all permissions) |
| Staff @ kavya.myshop.com/admin — only granted permissions | `users` + `user_roles`; `requirePermission`; T9 |
| Customer @ kavya.myshop.com — browse, buy, track order | `customers` (per shop), AccountPage, TrackPage; T13 |

## §5 Everything dynamic
| PDF line | Implementation |
|---|---|
| 5.1 Permission list is yours (global): PRODUCT_CREATE, ORDER_VIEW… backend checks only these | `permissions` table (V7 seeds 30 codes); `setRolePermissions` accepts only global codes |
| Roles belong to client: tick checkboxes, create any number of roles | `roles` (tenant_id), `role_permissions`; RolesPage; T9 |
| Two clients can both have "Store Manager" – different rows, different permissions | `UNIQUE (tenant_id, name)`; every tenant gets its own copy |
| Spring Boot @PreAuthorize → role name doesn't matter, only permission; new role needs no code | `requirePermission('ORDER_VIEW')`; T10 (permission added → works immediately) |
| 5.2 Only menus the user has permission for come from `GET /api/me/menus` | `meRouter.get('/menus')` → `userMenus()`; T4, T9 |
| Client can rename, hide, drag & drop reorder menus | `tenant_menus`; MenusPage (CDK drag-drop); T12 |
| 5.3 Invite staff by email, one or many roles | `/api/admin/staff/invite`, `user_invitations`, AcceptInvitePage; T9 |
| Staff count limited by plan | `plans.max_staff` + `tenant_limits`; `assertStaffLimit`; T11 |
| 5.4 Layer 1 Theme: layout, header, product card style (Angular components) — developer | `UI storefront/themes/*.layout.ts` + `THEME_REGISTRY`; `productCardStyle` |
| Layer 2 Customization: colour, font, logo, banner, border radius (JSON in DB) — client | `tenant_theme_settings.settings` JSON; ThemePage |
| Layer 3 Page sections: which block, which order — client drag & drop | `tenant_theme_settings.sections` JSON; `SectionEditorComponent` |
| Angular calls `/api/public/storefront-config` on start | `StorefrontService.load()` (route resolver) |
| Colours via CSS variables; layout lazy-loaded from theme code | `StorefrontService.apply()` sets `--sf-*`; `StorefrontShell` lazy-imports layout |
| Client sees live preview, Draft → Publish | DRAFT/PUBLISHED rows, preview token, iframe; T15 |

## §6 Architecture
| Component | Implementation |
|---|---|
| Browser (all 4 host types) → Caddy, wildcard SSL + automatic SSL for custom domains | `deploy/Caddyfile` |
| Angular apps — one build: Storefront, Store Admin, Super Admin | `frontend/` single app, `canMatch` by hostname (`app.routes.ts`) |
| /api/** → API (1..N instances) | Caddy `dynamic a api` load balancing; stateless `server.ts` |
| TenantFilter: Host header → tenant_id | `middleware/tenant.ts` |
| JwtFilter: token tenant = host tenant | `middleware/auth.ts`; T5 |
| @PreAuthorize permission check | `requirePermission()` |
| Hibernate @TenantId: tenant filter on every query | `db/tenant-scope.ts` `tq()/tinsert()` + dev guard in `db/knex.ts` + composite FKs (T6) |
| MySQL 8 · Redis cache · Object storage (images) | `db/knex.ts`, `cache/cache.ts`, `lib/storage.ts` (S3/R2 + CDN) |
| Worker (emails, DNS checks, renewals) | `worker.ts`, `jobs/email.job.ts`, `services/domain.service.ts`, `jobs/renewal.job.ts` |
| Security: token tenantId ≠ domain tenant → rejected; shop A user can't see shop B data | T5 (API) + T6 (DB) + T7 (data) |

## §7 100+ clients
| PDF line | Implementation |
|---|---|
| One UI, one API; no separate app per client | single build/process |
| Domain decides which client | `findTenantByHost()` (cached) |
| All clients' data in one table with tenant_id | every tenant table has `tenant_id` (DB V2–V6) |
| More traffic → 2, 3 API copies behind load balancer; needs stateless API (JWT, Redis, object storage) | `docker compose --scale api=3`; JWT + Redis + S3, no local state |
| Fix a bug once → fixed for all clients | single codebase |
| Cost stages: 1–50 one VPS Docker Compose; 50–300 app + DB server + Redis, 2 API; 300+ LB, 3+ API, managed MySQL + read replica, CDN | `docker-compose.yml` (stage 1); env `DB_HOST`/`REDIS_URL`/`CDN_BASE_URL` let you move to stages 2–3 without code change |

## §8 Speed
| PDF line | Implementation |
|---|---|
| 10,000 rows is tiny for MySQL | — |
| Index always starts with tenant_id, e.g. (tenant_id, status, created_at) | `ix_products_tenant_status_created`, `ix_orders_tenant_status_created`, every index on tenant tables starts with tenant_id |
| Pagination: admin pages offset (page numbers, total); storefront scroll, logs, APIs cursor (keyset) | `lib/pagination.ts` `offsetPaginate` (admin) / `cursorPaginate` (storefront, audit, customer orders, headless); T8 |
| Redis cache: domain lookup, theme, menus, permissions, rate limit counters | `cache/cache.ts` keys `dom:*`, `t:*:sf`, `t:*:acl:*`; `middleware/common.ts` `rateLimit` |
| Avoid N+1 with DTO projection / JOIN FETCH | explicit column lists + batch `attachImages()`, joined queries |
| Slowness comes from missing index, missing pagination, N+1 | all three handled above |

## §9 Custom design / non-shopping pages
| PDF line | Implementation |
|---|---|
| Never fork code; never `if (client == kavya)` | per-client behaviour only via DB config + `THEME_REGISTRY` |
| About, Gallery, Contact pages → page builder with section blocks + form builder (in plan) | `pages`, `forms`, `form_submissions`; PagesListPage/PageEditorPage/FormsPage; module PAGE_BUILDER in all plans; T17 |
| Unique design → exclusive theme only for them (same codebase, owner_tenant_id) — one-time fee | `themes.owner_tenant_id`; PfThemes; `service_requests` EXCLUSIVE_THEME + invoice |
| Booking, Blog → separate module, on only for them in tenant_modules — monthly add-on | modules BLOG, BOOKING (`is_addon`, price); `blog_posts`, `booking_services`, `bookings`; T19 |
| Separate website → shop.theirdomain.com or headless API (API key) — higher plan | custom domains + `api_keys` + `/api/headless/v1/*` (Business plan); T23 |
| Generic custom work can be sold later to others as add-on | modules table + plan/add-on pricing in Super Admin |

## §10 Revenue
| Stream | Implementation |
|---|---|
| Monthly / yearly subscription ₹499 / ₹999 / ₹1,999 | `plans` seed (BASIC/PRO/BUSINESS); `subscriptions`; T1 |
| Custom domain only Pro and above | `plans.allow_custom_domain`; T18 (blocked on BASIC) |
| Premium themes one-time purchase | `themes.is_premium/price`, `tenant_themes`, billing `/themes/:id/purchase`; T16 |
| Store setup service ₹5,000 | `platform_settings.setup_service_fee`, `service_requests` STORE_SETUP auto-invoice |
| Custom design / module: design fee + monthly add-on | `service_requests` quote + `monthly_addon`, manual invoices in Super Admin |
| Transaction fee (optional) 1% per order on Basic | `plans.transaction_fee_percent`, `transaction_fees`, billed on renewal; T13, T22 |

## §11 Technology stack
| PDF | This project |
|---|---|
| Angular (Storefront, Store Admin, Super Admin) – shared library | Angular 20; `frontend/src/app/shared` shared library |
| Java 21, Spring Boot 3, Spring Security, JPA (Hibernate 6 @TenantId) | **Node.js 22, Express 5, TypeScript, JWT + permission middleware, Knex tenant-scoped repository** |
| MySQL 8, Flyway migrations | MySQL 8, versioned `V<n>__*.sql` migrations (Flyway naming) via `npm run migrate` |
| Redis + Caffeine | Redis + lru-cache |
| Caddy (on-demand TLS) + Cloudflare DNS | `deploy/Caddyfile`, `Dockerfile.caddy` (cloudflare plugin) |
| S3-compatible object storage + CDN | `lib/storage.ts` (@aws-sdk/client-s3, `CDN_BASE_URL`) |
| Razorpay (client's own keys; your account for platform billing) | `lib/razorpay.ts`, `order.service.ts`, `billing.service.ts` |
| Docker Compose, GitHub Actions CI/CD | `docker-compose.yml`, `.github/workflows/ci-cd.yml` |

## §12 Phases & gates
| Phase | Gate in PDF | Proven by |
|---|---|---|
| 1 MVP: tenant creation, subdomain, wildcard SSL, products, orders, COD + Razorpay, one theme | a pilot shop gets a real paid order | T2, T7, T13 + UI order placed in browser |
| 2 Access control: dynamic roles, permissions, staff, menus, audit log | staff sees only allowed menu & API | T9, T10, T11, T12, T14 |
| 3 Branding: theme customisation, live preview, custom domain | client connects domain & publishes theme without developer | T15, T18 |
| 4 Self-service: self-signup, plans, auto-renewal, GST invoices, notifications | new client goes live with no manual work | T2, T22, worker emails |
| 5 Growth: reports, coupons, page builder, SEO, impersonation | ready for 100 clients | T17, T21, T24, T25 |

## Summary line
"One code, one build, one database; every client difference is configuration in the database" — implemented exactly so.
