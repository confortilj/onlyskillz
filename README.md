# skillz.ai — the marketplace for LLM powerups

A Patreon/Splice-style marketplace for AI assets: agent skills, prompt packs, datasets,
avatars, voices, fine-tuned models, MCP connectors, workflows, RAG packs, eval suites, and
asset packs. Subscription + credits, designer revenue share, and **forensic per-buyer
watermarking** so leaked content traces back to the account that leaked it.

## Stack
- **Frontend:** single-file `index.html` (vanilla JS, dark/light themes). Connects to the live
  Supabase backend; falls back to a self-contained demo if the backend is unreachable.
- **Backend:** Supabase (Postgres + RLS, Auth, Storage, Edge Functions, pg_cron).
- **Payments:** Stripe + Stripe Connect (demo mode until keys are set).
- **Email:** Resend (logs to `email_log` until keyed).

## Repo layout
```
index.html                     the app
LAUNCH-CHECKLIST.md            go-live steps + what's done
legal/                         ToS + DMCA drafts (need attorney review)
supabase/
  migrations/0001_init.sql     full schema, RLS, triggers, storage
  functions/                   10 edge functions (deployed source)
```

## Edge functions
| Function | Auth | Purpose |
|---|---|---|
| `acquire` | user JWT | Issues licenses, enforces tier/credits, builds the **multi-format watermarked** artifact, registers the fingerprint, fires receipt email |
| `decode-fingerprint` | admin key | Universal decoder — paste leaked text/CSV/WAV/MP4/safetensors → source account |
| `submit-product` | user JWT | Designer upload + **deep static security scan v2.0**; auto-publish ≥70, block on critical |
| `process-scan-queue` | cron/admin | **Dynamic sandbox worker** — isolated Deno Worker behavioral pass; auto-depublishes |
| `stripe-checkout` | user JWT | Subscriptions + credit top-ups (demo-safe) |
| `stripe-webhook` | signature | Renewals, credit refills, **lapse enforcement** (deactivates licenses) + lapse email |
| `stripe-connect` | user JWT | Designer payout onboarding (Express) |
| `payout-run` | cron/admin | Monthly revenue-share computation + Connect transfers + payout email |
| `scan-web` | cron/admin | **Auto-takedown crawler** — finds watermarks online, records takedowns |
| `send-email` | internal/admin | Transactional email (welcome, receipt, lapse, payout) |

## Watermarking (per format)
- Text (skill/prompt/mcp/workflow/eval) → zero-width steganography
- Dataset/RAG → per-buyer canary rows
- Voice → LSB audio watermark · Avatar → MP4 metadata atom + per-frame blocks
- Model → safetensors metadata fingerprint · Assets → SVG metadata + zero-width

## Deploy
1. **Backend** is already live (Supabase project `cvpkdnuqtpqxstglfjhb`). To reproduce elsewhere:
   `supabase db push` then `supabase functions deploy` for each function in `supabase/functions/`.
2. **Frontend:** deploy `index.html` to Vercel/Netlify (static, no build).
3. **Secrets** (Supabase → Edge Functions → Secrets): `CRON_SECRET`, `ADMIN_API_KEY`,
   `INTERNAL_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`,
   optional `GITHUB_TOKEN`. See `LAUNCH-CHECKLIST.md`.

> ⚠️ Never commit secrets. `.gitignore` excludes `.env`. The frontend only contains the
> Supabase publishable (anon) key, which is safe to expose.
