// skillz.ai — acquire v3: license + multi-format watermark (+video) + receipt email
import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildArtifact } from "./watermark.ts";
const PLAN_RANK: Record<string, number> = { free: 0, starter: 1, pro: 2, enterprise: 3 };
const CREDIT_TYPES = ["dataset", "model", "rag", "assets"]; const RENTAL_TYPES = ["avatar", "voice"];
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
    const { product_id, mode } = await req.json();
    if (!product_id) return json({ error: "product_id required" }, 400);
    const { data: product } = await admin.from("products").select("*").eq("id", product_id).single();
    if (!product || !product.published) return json({ error: "Product not found" }, 404);
    const { data: profile } = await admin.from("profiles").select("*").eq("id", user.id).single();
    if (!profile) return json({ error: "Profile missing" }, 500);
    if (!profile.sub_active) return json({ error: "Subscription lapsed — reactivate to acquire items" }, 403);
    const { data: existing } = await admin.from("licenses").select("*").eq("user_id", user.id).eq("product_id", product_id).maybeSingle();
    let license = existing; let newlyIssued = false;
    if (!existing) {
      newlyIssued = true; let kind = "subscription"; let creditCost = 0; let status = "active";
      if (RENTAL_TYPES.includes(product.type)) { if (mode === "buyout") { kind = "buyout"; creditCost = product.buyout_price; status = "perpetual"; } else { kind = "rental"; creditCost = product.rent_price; } }
      else if (CREDIT_TYPES.includes(product.type)) { kind = "credit_purchase"; creditCost = product.credits_price ?? 0; }
      else { if (PLAN_RANK[profile.plan] < PLAN_RANK[product.tier]) return json({ error: `Requires the ${product.tier} plan or higher` }, 403); }
      if (creditCost > 0) { if (profile.credits < creditCost) return json({ error: `Not enough credits: need ${creditCost}, have ${profile.credits}` }, 402);
        await admin.from("profiles").update({ credits: profile.credits - creditCost }).eq("id", user.id);
        await admin.from("credit_ledger").insert({ user_id: user.id, delta: -creditCost, reason: kind, product_id }); }
      const { data: lic, error: licErr } = await admin.from("licenses").insert({ user_id: user.id, product_id, kind, status, license_key: `sk-live-${rand(8)}-${rand(8)}-${rand(8)}`, credits_spent: creditCost }).select().single();
      if (licErr) return json({ error: licErr.message }, 500); license = lic;
      await admin.from("products").update({ downloads: (product.downloads ?? 0) + 1 }).eq("id", product_id);
    } else if (existing.status === "deactivated") return json({ error: "License deactivated — reactivate your subscription" }, 403);

    const fpCode = `SKZFP1.${rand(6)}.${(await sha256Hex(new TextEncoder().encode(user.id + product_id + Date.now()))).slice(0, 16)}`;
    const docs = product.docs ?? {};
    const docText = [`# ${product.name} v${product.version ?? "1.0"}`, ``, `> Licensed via skillz.ai — License ${license!.license_key}`, `> Individually fingerprinted. Redistribution violates the skillz.ai Terms of Service.`, ``, `## Overview`, docs.overview ?? product.description ?? "", ``, `## Usage`, docs.usage ?? "", ``, `## Install`, "```", docs.install ?? "", "```", ``, `<!-- ${rand(4)} -->`].join("\n");
    const art = buildArtifact(product, fpCode, docText); const artifactSha = await sha256Hex(art.bytes);
    const { data: fp } = await admin.from("fingerprints").insert({ fingerprint_code: fpCode, user_id: user.id, product_id, license_id: license!.id, artifact_sha256: artifactSha, ip_address: req.headers.get("x-forwarded-for")?.split(",")[0] ?? null, user_agent: req.headers.get("user-agent") ?? null, method: art.method, artifact_format: art.format }).select().single();
    if (art.canary && fp) await admin.from("canaries").insert({ fingerprint_code: fpCode, product_id, user_id: user.id, canary_signature: art.canary.signature, row_positions: art.canary.positions });
    await admin.from("download_events").insert({ user_id: user.id, product_id, fingerprint_id: fp?.id ?? null });

    if (newlyIssued) { try { await admin.functions.invoke("send-email", { body: { internal_key: Deno.env.get("INTERNAL_KEY") ?? "internal", user_id: user.id, template: "receipt", data: { product: product.name, license: license!.license_key, kind: license!.kind, watermark: art.method } } }); } catch (_) { /* non-blocking */ } }

    return json({ ok: true, license_key: license!.license_key, kind: license!.kind, status: license!.status,
      artifact: { filename: art.filename, mime: art.mime, base64: b64(art.bytes), sha256: artifactSha, watermark_method: art.method, format: art.format },
      notice: `This ${art.format.toUpperCase()} artifact is forensically fingerprinted to your account via ${art.method}.` });
  } catch (e) { return json({ error: String(e) }, 500); }
});
