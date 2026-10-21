# Multi-Tenant Store Platform — Angular 20 + Node.js + MySQL 8

Same project as `Multi_Tenant_Platform_Tamil_3.pdf`, with the **Spring Boot backend replaced by Node.js
(Express + TypeScript)**. One code, one build, one database — every difference between clients lives in the
database as configuration (PDF §1).

```
myshop-platform/
├─ database/migrations/   V1..V7 versioned SQL (53 tables, MySQL 8) — the source of truth for the DB
├─ backend/               Node.js 22 · Express 5 · TypeScript · Knex/mysql2 · Redis · BullMQ
│  ├─ src/server.ts       stateless API (run 1..N copies)
│  ├─ src/worker.ts       emails · DNS checks · renewals (PDF §6 Worker)
│  └─ test/e2e.test.ts    25 end-to-end tests, one per PDF feature
├─ frontend/              Angular 20 — ONE build: marketing · storefront · store admin · super admin
├─ deploy/                Caddyfile (wildcard + on-demand SSL), Dockerfiles, .env.example
├─ docker-compose.yml     Stage-1 deployment on one VPS (PDF §7)
├─ .github/workflows/     CI/CD (GitHub Actions)
└─ COVERAGE.md            every line of the PDF -> where it is implemented
```

## Spring Boot → Node.js mapping

| PDF (Spring Boot)                                   | This project (Node.js)                                                        |
|-----------------------------------------------------|-------------------------------------------------------------------------------|
| Java 21, Spring Boot 3                              | Node.js 22, Express 5, TypeScript 5                                           |
| `TenantFilter` (Host → tenant_id)                   | `src/middleware/tenant.ts` + AsyncLocalStorage request context               |
| `JwtFilter` (token tenant = host tenant)            | `src/middleware/auth.ts` → `requireAuth()` rejects `TENANT_MISMATCH`           |
| `@PreAuthorize("hasAuthority('ORDER_VIEW')")`       | `requirePermission('ORDER_VIEW')` middleware                                  |
| Hibernate 6 `@TenantId`                             | `tq()` / `tinsert()` tenant-scoped Knex builder + composite FKs in MySQL      |
| JPA DTO projection / JOIN FETCH (avoid N+1)         | explicit column selects + batch loaders (`attachImages()`)                    |
| Flyway migrations                                   | `npm run migrate` — Flyway-style `V<n>__name.sql`, checksum-verified           |
| Redis + Caffeine                                    | Redis (L2) + `lru-cache` (L1) with pub/sub invalidation across instances      |
| Spring `@Scheduled` worker                          | BullMQ worker (`src/worker.ts`) with repeatable jobs                          |

## Run locally on Windows (VS Code + PowerShell)

Prerequisites: Node.js 22, MySQL 8, Redis (Memurai or `docker run -p 6379:6379 redis`).

```powershell
# 1. database + API
cd backend
copy .env.example .env          # set DB_USER / DB_PASSWORD
npm install
npm run migrate                 # creates DB "myshop" and all tables
npm run seed:superadmin -- admin@myshop.test "SuperAdmin@123" "KK"
npm run seed:demo               # demo store "Kavya Textiles" (owner@kavya.test / Password@123)
npm run dev                     # API on :3000
# second terminal
npm run dev:worker

# 2. Angular (third terminal)
cd ..\frontend
npm install
npx ng serve                    # :4200, /api proxied to :3000
```

Chrome/Edge resolve `*.localhost` automatically, so one dev server serves every surface:

| URL                                   | Surface (PDF §2)                    |
|---------------------------------------|-------------------------------------|
| http://localhost:4200                 | your website — features, pricing, signup |
| http://admin.localhost:4200           | Super Admin panel                   |
| http://kavya.localhost:4200           | Kavya Textiles storefront           |
| http://kavya.localhost:4200/admin     | Kavya's Store Admin panel           |

Tests (API must be running): `cd backend; npm test` → 25 passing.

## Production (one VPS, PDF §7 stage 1)

1. DNS at Cloudflare: `myshop.com` A → server IP, `*.myshop.com` A → server IP, `stores.myshop.com` A → server IP.
2. `cp deploy/.env.example deploy/.env` and fill secrets (Cloudflare token for the wildcard certificate).
3. ```bash
   docker compose --env-file deploy/.env up -d --build
   docker compose --env-file deploy/.env run --rm migrate
   docker compose --env-file deploy/.env exec api node dist/scripts/seed-superadmin.js admin@myshop.com 'StrongPass123'
   ```
4. Scale the API when traffic grows: `docker compose up -d --scale api=3` (Caddy load-balances automatically).

GitHub Actions deploys on every push to `main` (secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`).

## Notes / things to confirm before going live
- **SAC code** for SaaS invoices defaults to `998314`; set the right one and your GSTIN in Super Admin → Settings (confirm with your CA).
- **Razorpay**: each client enters their own keys (money goes straight to them). Your own keys in `deploy/.env` are only for platform billing.
- Auto-renewal = automatic GST invoice + email + payment link + suspension after the grace period. True card auto-debit needs a Razorpay Subscriptions mandate (webhook already handled at `/api/webhooks/razorpay`).
