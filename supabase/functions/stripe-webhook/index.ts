// skillz.ai — stripe-webhook v3: new plans (basic/pro/developer), product purchases ($), lapse emails
import { createClient } from "jsr:@supabase/supabase-js@2";
const PLANS: Record<string, { credits: number; share: number }> = {
  basic: { credits: 60, share: 67 }, pro: { credits: 130, share: 67 }, developer: { credits: 175, share: 67 },
  // legacy
  starter: { credits: 60, share: 67 }, enterprise: { credits: 175, share: 67 },
};
const PLATFORM_FEE = 0.33; // platform keeps 33% of every transaction
const rand = (n: number) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map((b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join(""); };
async function verifySig(payload: string, sigHeader: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(sigHeader.split(",").map((p) => p.split("=")) as [string, string][]); const t = parts["t"], v1 = parts["v1"]; if (!t || !v1) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("") === v1;
}
async function email(admin: any, user_id: string, template: string, data: any) { try { await admin.functions.invoke("send-email", { body: { internal_key: Deno.env.get("INTERNAL_KEY") ?? "internal", user_id, template, data } }); } catch (_) { /* */ } }

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET"); const payload = await req.text();
  if (secret) { if (!(await verifySig(payload, req.headers.get("stripe-signature") ?? "", secret))) return new Response("bad signature", { status: 400 }); }
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let event: any; try { event = JSON.parse(payload); } catch { return new Response("bad json", { status: 400 }); }
  const obj = event.data?.object ?? {}; const userId = obj.metadata?.user_id;
  switch (event.type) {
    case "checkout.session.completed": {
      if (obj.mode === "subscription" && userId && obj.metadata?.plan) { const plan = obj.metadata.plan; const p = PLANS[plan] ?? { credits: 0, share: 67 }; const renewal = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
        await admin.from("profiles").update({ plan, sub_active: true, sub_renewal: renewal, credits: p.credits, revenue_share: p.share }).eq("id", userId);
        await admin.from("credit_ledger").insert({ user_id: userId, delta: p.credits, reason: "monthly_refill", stripe_payment_intent: obj.payment_intent ?? null });
        await admin.from("licenses").update({ status: "active" }).eq("user_id", userId).neq("status", "perpetual"); }
      if (obj.mode === "payment" && userId && obj.metadata?.topup_credits) { const add = parseInt(obj.metadata.topup_credits, 10); const { data: prof } = await admin.from("profiles").select("credits").eq("id", userId).single(); await admin.from("profiles").update({ credits: (prof?.credits ?? 0) + add }).eq("id", userId); await admin.from("credit_ledger").insert({ user_id: userId, delta: add, reason: "topup", stripe_payment_intent: obj.payment_intent ?? null }); }
      // seller-priced ($) product purchase → grant license + record sale (33% platform / 67% seller)
      if (obj.mode === "payment" && userId && obj.metadata?.product_id) {
        const pid = obj.metadata.product_id;
        const { data: product } = await admin.from("products").select("id, name, designer_id, designer_label, downloads").eq("id", pid).maybeSingle();
        const { data: existing } = await admin.from("licenses").select("id").eq("user_id", userId).eq("product_id", pid).maybeSingle();
        if (product && !existing) {
          const kind = obj.metadata.license_kind ?? "buyout"; const status = obj.metadata.license_status ?? "perpetual";
          const { data: lic } = await admin.from("licenses").insert({ user_id: userId, product_id: pid, kind, status, license_key: `sk-live-${rand(8)}-${rand(8)}-${rand(8)}`, credits_spent: 0 }).select().single();
          const cents = parseInt(obj.metadata.amount_cents ?? "0", 10) || (obj.amount_total ?? 0);
          const fee = Math.round(cents * PLATFORM_FEE);
          await admin.from("usd_sales").insert({ user_id: userId, product_id: pid, seller_id: product.designer_id, seller_label: product.designer_label, amount_cents: cents, platform_fee_cents: fee, seller_net_cents: cents - fee, stripe_payment_intent: obj.payment_intent ?? null, license_id: lic?.id ?? null });
          await admin.from("products").update({ downloads: (product.downloads ?? 0) + 1 }).eq("id", pid);
          await email(admin, userId, "receipt", { product: product.name, license: lic?.license_key, kind });
        }
      }
      break; }
    case "invoice.paid": { const { data: prof } = await admin.from("profiles").select("id, plan").eq("stripe_customer_id", obj.customer).maybeSingle(); if (prof) { const p = PLANS[prof.plan] ?? { credits: 0 }; const renewal = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10); await admin.from("profiles").update({ sub_active: true, sub_renewal: renewal, credits: p.credits }).eq("id", prof.id); await admin.from("credit_ledger").insert({ user_id: prof.id, delta: p.credits, reason: "monthly_refill" }); } break; }
    case "invoice.payment_failed":
    case "customer.subscription.deleted": { const { data: prof } = await admin.from("profiles").select("id").eq("stripe_customer_id", obj.customer).maybeSingle(); if (prof) { await admin.from("profiles").update({ sub_active: false }).eq("id", prof.id); await admin.from("licenses").update({ status: "deactivated" }).eq("user_id", prof.id).neq("status", "perpetual"); await email(admin, prof.id, "lapse_warning", {}); } break; }
  }
  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});
