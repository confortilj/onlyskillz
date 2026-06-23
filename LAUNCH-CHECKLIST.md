# skillz.ai — Go-Live Checklist

## ✅ Already live (built this session)
- **Backend:** Supabase project `skillz-ai` (ref `cvpkdnuqtpqxstglfjhb`, us-east-1, $0/mo free tier)
  - Tables: profiles, products (28 seeded across 11 product lines), licenses, fingerprints, upvotes, credit_ledger, payouts, download_events — all with RLS
  - Auto profile creation on signup; upvote counters via trigger
- **Edge functions (deployed & active):**
  - `acquire` — license issuance, tier/credit enforcement, forensic watermarking, fingerprint registry
  - `decode-fingerprint` — paste leaked content → identifies the source account (admin-only)
  - `stripe-checkout` — subscriptions, top-ups, cancel/reactivate (demo billing until keys added)
  - `stripe-webhook` — renewals, credit refills, lapse enforcement (deactivates licenses on failed payment/cancellation)
  - `submit-product` — designer upload + REAL automated security scan (blocks below score 70; Verified Safe at 90+); stores bundle in private storage
  - `payout-run` — monthly designer revenue-share computation from the credit ledger → payouts table; auto Stripe Connect transfers when keys + connect IDs present
- **Storage:** private `bundles` bucket for raw designer uploads (service-role access only)
- **Verified live this session:** clean upload scored 100/100 → published with Verified Safe; malicious upload (eval + exfil URL + rm -rf) scored 40/100 → auto-blocked; watermark embed→leak→decode round-trip recovers the exact account fingerprint from a single copied line
- **Frontend:** `index.html` — connects to the live backend automatically; real signup/login, live catalog, watermarked downloads, billing actions. Falls back to demo mode offline.
- **Legal scaffolds:** `legal/terms-of-service.md`, `legal/dmca-policy.md`

## 🟢 Full lifecycle layer — DONE this session (the "10/10" engineering)
- **Dynamic sandbox worker** (`process-scan-queue`): post-publish deep pass that runs candidate content in an **isolated Deno Worker** (time-boxed, no parent scope) with behavioral heuristics — staged multi-layer decode, delayed execution, env-fingerprinting, runtime-deobfuscated exec. Auto-**depublishes** anything that reveals critical intent at runtime (verified: caught an obfuscated payload that passed static scan). Runs every 5 min via pg_cron.
- **Frame-level video watermarking** (MP4): fingerprint embedded in a container metadata atom **and** repeated per-frame blocks — verified to survive full-file, single-frame-clip, and metadata-stripped extraction. Avatars now deliver watermarked MP4; voices deliver watermarked WAV. Universal decoder reads both.
- **Stripe Connect onboarding** (`stripe-connect`): designers click "Set up payouts" in the dashboard → Express onboarding (live) or instant activation (demo). **Automated monthly payout cron** (`payout-run` v2) computes shares, transfers via Connect, emails designers, logs every run.
- **Transactional email** (`send-email`, Resend-backed): welcome, receipt, lapse-warning, payout-sent. **Verified live end-to-end**: signup → DB trigger → send-email → `email_log` row. Logs in demo, sends real email the moment `RESEND_API_KEY` is set.
- **Auto-takedown crawler** (`scan-web`): fetches candidate URLs + GitHub code-search hits, extracts any watermark/canary, resolves the leaking account, records a `takedown`. Runs daily via pg_cron.
- **Admin security console** (in-app `/admin`): paste leaked content → trace to account; trigger payouts/scan-queue/crawler on demand. Activates once `ADMIN_API_KEY` is set.
- **Recurring jobs live:** scan-queue (5 min), payouts (monthly), leak-crawler (daily) — all scheduled in pg_cron.

## 🟡 Your 10-minute tasks (only you can do these)
1. **Deploy the frontend** — create a free Vercel account (vercel.com) → "Add New Project" → drag the `Skillz.ai` folder in (or `npx vercel` in the folder). It's a single static file; no build config needed. Netlify Drop works too.
2. **Domain** — buy `skillz.ai` (or your fallback) at your registrar; point it at Vercel (one CNAME record, Vercel walks you through it).
3. **Stripe** — create account at stripe.com → get approved → then in the Supabase dashboard (Project Settings → Edge Functions → Secrets) add:
   - `STRIPE_SECRET_KEY` (starts `sk_live_` or `sk_test_`)
   - `STRIPE_WEBHOOK_SECRET` (create a webhook in Stripe pointing to `https://cvpkdnuqtpqxstglfjhb.supabase.co/functions/v1/stripe-webhook`, events: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`)
   - Billing flips from demo to live automatically — zero code changes.
4. **Admin key** — add secret `ADMIN_API_KEY` (any long random string) to enable the fingerprint decoder. Test it:
   `POST https://cvpkdnuqtpqxstglfjhb.supabase.co/functions/v1/decode-fingerprint` with header `x-admin-key: <your key>` and body `{"text":"<paste suspected leaked content>"}`
5. **Legal entity + lawyer** — form an LLC, have counsel review both legal docs (especially liquidated damages + fingerprinting consent), and register your DMCA agent ($6, dmca.copyright.gov).
6. **Stripe Connect** (week 2) — apply for Connect in the Stripe dashboard to automate designer payouts; until then, pay designers manually from the `payouts` table.

## 🟢 MVP hardening — DONE this session
- **Multi-format forensic watermarking** (all 8 formats traced live, incl. partial-leak):
  - Text (skills/prompts/MCP/workflows/evals) → zero-width steganography
  - Datasets/RAG (CSV/JSONL) → per-buyer canary rows (registered in `canaries` table)
  - Voice/avatar audio (WAV) → LSB audio watermark
  - Models/LoRAs (safetensors) → metadata-header fingerprint + checksum
  - Asset packs (SVG) → metadata + zero-width marks
  - Universal `decode-fingerprint` auto-detects format and returns the evidence package
- **Deep static scanner (engine v2.0)** replaces the regex: recursive base64/hex payload decoding (catches obfuscated malware), Shannon-entropy obfuscation detection, tokenized dangerous-call analysis with CWE tags, credential/secret leak detection, URL+IP exfiltration analysis, permission and dependency review. Critical → blocked; secrets/injection → manual review; clean → auto-publish + dynamic sandbox queued.
- **Verified live:** full trace-back query resolved a leaked dataset canary → account + IP + timestamp + license + artifact hash; fingerprint registry intentionally survives account deletion (evidence preservation).

## 🔵 Remaining roadmap (say the word)
- True dynamic sandbox worker (runs queued post-publish deep scans in an isolated container)
- Frame-level video watermarking in the avatar render pipeline (audio track already covered)
- Stripe Connect onboarding flow + automated monthly payout job (compute engine already built)
- Email (transactional receipts, lapse warnings — big retention lever)
- Auto-takedown crawler (GitHub/HuggingFace watermark scanning)

## How the forensic system works (plain English)
Every download is rebuilt per-user with an invisible serial number (zero-width Unicode steganography) woven in at three locations, plus a visible license key. The serial maps to account + timestamp + IP in the `fingerprints` table, which has **no public access policy** — only your service key or the admin decoder can read it. Find a leak → paste it into the decoder → get the account → pull the evidence package. Copy-pasting even one marked line of the file carries the serial with it.
