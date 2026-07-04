// skillz.ai — acquire v4: plan-type access + credit/USD pricing + multi-format watermark + receipt email
// Pricing model: Basic (skills/prompts/models), Pro (+avatars/voices), Developer (everything).
// Credit-priced items charge credits; seller-priced items ($) return a Stripe Checkout URL,
// and the license is granted by the stripe-webhook on payment. Platform keeps 33%.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildArtifact, watermarkRealFile } from "./watermark.ts";

const PLAN_TYPES: Record<string, string[]> = {
  basic:     ["skill", "prompt", "model"],
  pro:       ["skill", "prompt", "model", "avatar", "voice"],
  developer: ["skill", "prompt", "model", "avatar", "voice", "dataset", "workflow", "rag", "eval", "assets"],
  // legacy plan ids map to nearest new plan
  free: [], starter: ["skill", "prompt", "model"], enterprise: ["skill", "prompt", "model", "avatar", "voice", "dataset", "workflow", "rag", "eval", "assets"],
};
const PLAN_LABEL: Record<string, string> = { skill: "Basic", prompt: "Basic", model: "Basic", avatar: "Pro", voice: "Pro", dataset: "Developer", workflow: "Developer", rag: "Developer", eval: "Developer", assets: "Developer" };

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
async function sha256Hex(bytes: Uint8Array): Promise<string> { const d = await crypto.subtle.digest("SHA-256", bytes); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
const rand = (n: number) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map((b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join(""); };
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supaUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization")! } } });
    const admin = createClient(supaUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Not authenticated" }, 401);
    const { product_id, mode, success_url, cancel_url } = await req.json();
    if (!product_id) return json({ error: "product_id required" }, 400);
    const { data: product } = await admin.from("products").select("*").eq("id", product_id).single();
    if (!product || !product.published) return json({ error: "Product not found" }, 404);
    const { data: profile } = await admin.from("profiles").select("*").eq("id", user.id).single();
    if (!profile) return json({ error: "Profile missing" }, 500);
    if (!profile.sub_active) return json({ error: "Subscription lapsed — reactivate to acquire items" }, 403);

    // ---- rate limit: max 20 downloads per hour ----
    const hourAgo = new Date(Date.now() - 3600e3).toISOString();
    const { count: recentDl } = await admin.from("download_events").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", hourAgo);
    if ((recentDl ?? 0) >= 20) return json({ error: "Rate limit: max 20 downloads per hour. Try again later." }, 429);

    // ---- plan-type access gate ----
    const allowed = PLAN_TYPES[profile.plan] ?? [];
    if (!allowed.includes(product.type)) {
      return json({ error: `Your plan does not include ${product.type}s — requires the ${PLAN_LABEL[product.type] ?? "Developer"} plan or higher` }, 403);
    }

    const { data: existing } = await admin.from("licenses").select("*").eq("user_id", user.id).eq("product_id", product_id).maybeSingle();
    let license = existing; let newlyIssued = false;
    if (!existing) {
      // ---- pricing: credits vs seller-set USD ----
      let creditCost = 0; let usdCents = 0; let kind = "credit_purchase"; let status = "active";
      if (product.type === "avatar" || product.type === "voice") {
        if (mode === "commercial") { usdCents = product.price_usd_cents ?? 0; kind = "buyout"; status = "perpetual"; }
        else { creditCost = product.credits_price ?? 60; }              // personal-use pack
      } else if (product.credits_price != null) {
        creditCost = product.credits_price;                              // skills 5, prompts 2, workflows 30, datasets S/M 15/30
      } else {
        usdCents = product.price_usd_cents ?? 0;                         // models, large datasets, rag/eval/asset packs (0 = free)
        if (usdCents > 0) { kind = "buyout"; status = "perpetual"; }
      }

      // ---- seller-priced ($) items: hand off to Stripe Checkout; webhook grants the license ----
      if (usdCents > 0) {
        const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
        if (!stripeKey) return json({ error: "Card payments are not enabled yet — STRIPE_SECRET_KEY missing" }, 503);
        let customerId = profile.stripe_customer_id;
        const sfetch = (path: string, body: Record<string, string>) =>
          fetch(`https://api.stripe.com/v1/${path}`, { method: "POST", headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) }).then((r) => r.json());
        if (!customerId) { const cust = await sfetch("customers", { email: user.email ?? "", "metadata[user_id]": user.id }); customerId = cust.id; await admin.from("profiles").update({ stripe_customer_id: customerId }).eq("id", user.id); }
        const session = await sfetch("checkout/sessions", {
          customer: customerId!, mode: "payment",
          "line_items[0][price_data][currency]": "usd",
          "line_items[0][price_data][product_data][name]": `skillz.ai — ${product.name}${mode === "commercial" ? " (commercial license)" : ""}`,
          "line_items[0][price_data][unit_amount]": String(usdCents),
          "line_items[0][quantity]": "1",
          "metadata[user_id]": user.id, "metadata[product_id]": product_id,
          "metadata[license_kind]": kind, "metadata[license_status]": status,
          "metadata[amount_cents]": String(usdCents),
          success_url: success_url ?? "https://onlyskillz.vercel.app/?purchase=success",
          cancel_url: cancel_url ?? "https://onlyskillz.vercel.app/",
        });
        if (!session.url) return json({ error: session?.error?.message ?? "Could not start checkout" }, 502);
        return json({ checkout: true, url: session.url, amount_cents: usdCents });
      }

      // ---- credit-priced (or free) items: charge credits and license immediately ----
      if (creditCost > 0) {
        if (profile.credits < creditCost) return json({ error: `Not enough credits: need ${creditCost}, have ${profile.credits}` }, 402);
        await admin.from("profiles").update({ credits: profile.credits - creditCost }).eq("id", user.id);
        await admin.from("credit_ledger").insert({ user_id: user.id, delta: -creditCost, reason: kind, product_id });
      }
      const { data: lic, error: licErr } = await admin.from("licenses").insert({ user_id: user.id, product_id, kind, status, license_key: `sk-live-${rand(8)}-${rand(8)}-${rand(8)}`, credits_spent: creditCost }).select().single();
      if (licErr) return json({ error: licErr.message }, 500); license = lic; newlyIssued = true;
      await admin.from("products").update({ downloads: (product.downloads ?? 0) + 1 }).eq("id", product_id);
    } else if (existing.status === "deactivated") return json({ error: "License deactivated — reactivate your subscription" }, 403);

    const fpCode = `SKZFP1.${rand(6)}.${(await sha256Hex(new TextEncoder().encode(user.id + product_id + Date.now()))).slice(0, 16)}`;
    const docs = product.docs ?? {};
    const docText = [`# ${product.name} v${product.version ?? "1.0"}`, ``, `> Licensed via skillz.ai — License ${license!.license_key}`, `> Individually fingerprinted. Redistribution violates the skillz.ai Terms of Service.`, ``, `## Overview`, docs.overview ?? product.description ?? "", ``, `## Usage`, docs.usage ?? "", ``, `## Install`, "```", docs.install ?? "", "```", ``, `<!-- ${rand(4)} -->`].join("\n");
    // deliver the seller's real uploaded file when one exists; fall back to the generated docs bundle
    let art = null as any;
    if (product.bundle_path && !product.bundle_path.endsWith("/SKILL.md")) {
      const { data: blob, error: dlErr } = await admin.storage.from("bundles").download(product.bundle_path);
      if (!dlErr && blob) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        art = watermarkRealFile(bytes, product.bundle_path.split(".").pop()!.toLowerCase(), product.id, fpCode);
      }
    }
    if (!art) art = buildArtifact(product, fpCode, docText);
    const artifactSha = await sha256Hex(art.bytes);
    const { data: fp } = await admin.from("fingerprints").insert({ fingerprint_code: fpCode, user_id: user.id, product_id, license_id: license!.id, artifact_sha256: artifactSha, ip_address: req.headers.get("x-forwarded-for")?.split(",")[0] ?? null, user_agent: req.headers.get("user-agent") ?? null, method: art.method, artifact_format: art.format }).select().single();
    if (art.canary && fp) await admin.from("canaries").insert({ fingerprint_code: fpCode, product_id, user_id: user.id, canary_signature: art.canary.signature, row_positions: art.canary.positions });
    await admin.from("download_events").insert({ user_id: user.id, product_id, fingerprint_id: fp?.id ?? null });

    if (newlyIssued) { try { await admin.functions.invoke("send-email", { body: { internal_key: Deno.env.get("INTERNAL_KEY") ?? "internal", user_id: user.id, template: "receipt", data: { product: product.name, license: license!.license_key, kind: license!.kind, watermark: art.method } } }); } catch (_) { /* non-blocking */ } }

    return json({ ok: true, license_key: license!.license_key, kind: license!.kind, status: license!.status,
      artifact: { filename: art.filename, mime: art.mime, base64: b64(art.bytes), sha256: artifactSha, watermark_method: art.method, format: art.format },
      notice: `This ${art.format.toUpperCase()} artifact is forensically fingerprinted to your account via ${art.method}.` });
  } catch (e) { return json({ error: String(e) }, 500); }
});
