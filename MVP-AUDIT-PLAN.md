# skillz.ai — MVP Readiness Audit & Build Plan
**Date:** 2026-07-04 · **Audited:** frontend (index.html), 10 edge functions, live Supabase schema (mkofedsnuzyflblwhdrs), Stripe live account, cron jobs, security advisors

> **STATUS UPDATE (same day):** Phases 1–3 implemented. ✅ Real file uploads w/ per-type validation (submit-product v3) · ✅ seller pricing at upload + editable in Studio · ✅ real Designer Studio (studio-stats) · ✅ admin moderation queue + refunds (admin-moderate) · ✅ real-file watermarked delivery (acquire v5) · ✅ rate limits · ✅ buyer/seller guides + refund policy + legal links + signup consent · ✅ "Editor's example" labels on seed items · ✅ buyer reviews (licensed-only, live rating sync) · ✅ security lints (security_invoker view; pg_net left in place — cron depends on it) · ✅ CI smoke tests (GitHub Actions). **Still yours (Phase 0):** push to GitHub, Stripe secrets + webhook, RESEND_API_KEY, ADMIN_API_KEY, DMCA agent, domain.

---

## 1. Scorecard — what's real vs demo vs missing

| Area | Status | Notes |
|------|--------|-------|
| Auth & profiles | ✅ Real | Supabase auth, auto profile on signup |
| Plans & gating (v2 pricing) | ✅ Real | Basic/Pro/Developer enforced server-side in `acquire` |
| Credit purchases & licensing | ✅ Real | Ledger, unique license keys, plan/balance checks server-side |
| Seller-priced ($) purchases | ⚠️ Real but blocked | Needs Stripe webhook live — license is granted by the webhook |
| Forensic watermarking | ✅ Real | 8 formats, verified trace-back incl. partial leaks |
| Security scanning | ✅ Real | Static engine v2 (CWE-tagged) + dynamic sandbox worker, auto-block/depublish |
| Leak crawler & takedowns | ✅ Real | Daily cron, decode-fingerprint, takedowns table |
| Payouts (67% flat) | ✅ Real | Monthly cron, credits @ $0.50 + usd_sales; Stripe Connect onboarding |
| Emails | ⚠️ Wired, dormant | Logs only until RESEND_API_KEY is set |
| Billing (subscriptions/top-ups) | ⚠️ Demo mode | Runs simulated until STRIPE_SECRET_KEY is set |
| Catalog content | 🟡 Seeded | 27 products, 4 fictional designers, fake stats |
| Seller file uploads | ❌ Missing | Text/markdown only — buyers receive generated watermark samples, not seller files |
| Seller pricing controls | ❌ Missing | Sellers can't set prices; upload form has no pricing fields |
| Designer Studio (real data) | ❌ Demo | Hardcoded "Maya" persona, fake earnings chart & payout history |
| Moderation dashboard | ❌ Missing | `needs_review` verdict has no UI; unpublish = manual SQL |
| Buyer / seller docs | ❌ Missing | Install commands reference a CLI that doesn't exist |
| Refunds & disputes | ❌ Missing | No product flow or policy |

---

## 2. Findings by severity

### 🔴 Blockers (before charging real money)
1. **Stripe secrets unset.** `STRIPE_SECRET_KEY` missing → all billing is simulated. `STRIPE_WEBHOOK_SECRET` + the webhook endpoint don't exist → even with the key, **seller-priced purchases would take payment but never grant the license** (the webhook grants it). Events needed: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted` → `https://mkofedsnuzyflblwhdrs.supabase.co/functions/v1/stripe-webhook`.
2. **Sellers can't upload real product files.** `submit-product` accepts only name/description/markdown. A paying buyer of a "model" receives a generated 16-byte watermark sample, not a model. This is the core marketplace gap.
3. **Sellers can't set prices.** All seller-priced ($) values were seeded by hand in the DB. The upload form has no pricing step (credits vs $, dataset size tier, personal/commercial for avatars & voices).
4. **Designer Studio is fake for real sellers.** A real signed-in seller sees Maya Okafor's hardcoded numbers instead of their own products/sales/payouts (all of which exist in the DB: `products`, `credit_ledger`, `usd_sales`, `payouts`).
5. **No real emails** until `RESEND_API_KEY` is set (receipts, lapse warnings, payout notices currently log-only).
6. **Seed data masquerades as traction.** Fake downloads/ratings/designers are indistinguishable from real ones. Decide: label as "featured examples," zero the stats, or remove at launch.

### 🟠 Major
7. **No moderation queue.** Products flagged `needs_review` sit invisible; removing a bad product requires SQL. Need an admin list with approve / reject / unpublish / takedown.
8. **No documentation.** No buyer install/download guide, no seller guide (formats, scan rules, pricing, payout terms). Product pages advertise `npx skillz add …` — that CLI doesn't exist.
9. **Security lints** (Supabase advisors): `products` view is SECURITY DEFINER (flagged ERROR — by design here since writes are revoked, but should move to `security_invoker` + explicit grants); `pg_net` extension in public schema; 7 service-only tables have RLS enabled with no policies (intentional deny-all — document it).
10. **No refund/dispute flow.** Stripe disputes will arrive with no process; no refund policy in ToS surface.
11. **No rate limiting / abuse controls** on `acquire` and `submit-product` (upload spam, credit-drain probing).
12. **No error monitoring, tests, or CI.** Single ~4,300-line index.html, no Sentry, no automated tests; regressions only caught manually.
13. **Legal docs not surfaced.** `legal/terms-of-service.md` and `dmca-policy.md` exist but aren't linked in the footer or at signup; DMCA agent registration still owed.

### 🟡 Minor
14. Vestigial v1 remnants: `tier` field on products, `TIERS` const, `state.rented` — dead but harmless.
15. Upload form still shows the old tier selector instead of pricing fields (folds into Blocker #3).
16. No reviews system (ratings are static seed numbers), no pagination/server-side search (fine at 27 products), no favorites.
17. No SEO/meta/OG tags, favicon, or analytics; custom domain not connected (site lives at onlyskillz.vercel.app).

---

## 3. Build plan

### Phase 0 — Your 15 minutes (only you can do these)
- [ ] Push the pending commit: `git -C ~/Documents/Claude/Projects/Skillz.ai push origin main`
- [ ] Supabase → Edge Functions → Secrets: add `STRIPE_SECRET_KEY`, `RESEND_API_KEY`, `ADMIN_API_KEY`
- [ ] Stripe dashboard → create the webhook (URL + 4 events above) → add `STRIPE_WEBHOOK_SECRET` to Supabase secrets
- [ ] Register DMCA agent ($6, dmca.copyright.gov); have counsel review the two legal docs
- [ ] (Optional) connect custom domain in Vercel

### Phase 1 — Make selling real (fixes Blockers 2, 3, 4 + Major 7)
1. **Real file uploads:** per-type upload with format validation (skills/prompts: md or zip · datasets/RAG: csv/jsonl/zip · models: safetensors/gguf · voices: wav/mp3 · avatars: mp4/zip · assets: zip/svg) → private `bundles` bucket; `acquire` delivers the seller's actual file, watermarked where format allows, fingerprint-logged always.
2. **Seller pricing step** in upload + edit: auto-priced types shown read-only (skill ⬡5, prompt ⬡2, workflow ⬡30); seller inputs for dataset size tier, $ price on L/XL datasets, models (0 = free), RAG/eval/asset packs, and avatar/voice commercial $; personal pack fixed at ⬡60.
3. **Real Designer Studio:** your products from `products` (by designer_id), sales & revenue from `credit_ledger` + `usd_sales` (with the 33% fee shown), payout history from `payouts`, edit price / unpublish buttons, simple pricing suggestions (compare price vs category median & conversion).
4. **Admin moderation queue:** list `needs_review` + reported products with scan findings inline; approve / reject / unpublish / record takedown; action log.

### Phase 2 — Trust & docs (fixes 6, 8, 10, 13)
5. Docs pages on-site: buyer guide (buying, credits, downloads, license terms) and seller guide (formats, scan rules, pricing model, 67% payouts, Connect setup). Replace fictional CLI copy.
6. Link ToS/DMCA in footer + signup checkbox; publish refund policy; wire a simple refund path (admin-triggered via Stripe, revokes license).
7. Seed-data decision: label sample products as "Editor's examples" or zero their stats.
8. Basic rate limits on acquire/submit (per-user per-minute caps in edge functions).

### Phase 3 — Hardening & growth
9. Fix advisor lints (security_invoker view, move pg_net, document deny-all RLS); add Sentry (or Supabase log drains) + uptime check.
10. Smoke-test suite in CI (the Node/VM harness already used this session, run on every push via GitHub Actions).
11. Reviews & ratings from real buyers; pagination + server-side search when catalog grows.
12. SEO/OG tags, favicon, analytics, custom domain.

**Suggested order:** Phase 0 today → Phase 1 next session (it's the difference between a demo and a marketplace) → Phase 2 before any marketing → Phase 3 as traction demands.
