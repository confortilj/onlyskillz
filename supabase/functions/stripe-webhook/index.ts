// skillz.ai — stripe-webhook v2: + lapse-warning email on payment failure/cancel
import { createClient } from "jsr:@supabase/supabase-js@2";
const PLANS: Record<string, { credits: number; share: number }> = { starter: { credits: 20, share: 60 }, pro: { credits: 60, share: 70 }, enterprise: { credits: 200, share: 80 } };
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
      if (obj.mode === "subscription" && userId && obj.metadata?.plan) { const plan = obj.metadata.plan; const p = PLANS[plan] ?? { credits: 0, share: 60 }; const renewal = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
        await admin.from("profiles").update({ plan, sub_active: true, sub_renewal: renewal, credits: p.credits, revenue_share: p.share }).eq("id", userId);
        await admin.from("credit_ledger").insert({ user_id: userId, delta: p.credits, reason: "monthly_refill", stripe_payment_intent: obj.payment_intent ?? null });
        await admin.from("licenses").update({ status: "active" }).eq("user_id", userId).neq("status", "perpetual"); }
      if (obj.mode === "payment" && userId && obj.metadata?.topup_credits) { const add = parseInt(obj.metadata.topup_credits, 10); const { data: prof } = await admin.from("profiles").select("credits").eq("id", userId).single(); await admin.from("profiles").update({ credits: (prof?.credits ?? 0) + add }).eq("id", userId); await admin.from("credit_ledger").insert({ user_id: userId, delta: add, reason: "topup", stripe_payment_intent: obj.payment_intent ?? null }); }
      break; }
    case "invoice.paid": { const { data: prof } = await admin.from("profiles").select("id, plan").eq("stripe_customer_id", obj.customer).maybeSingle(); if (prof) { const p = PLANS[prof.plan] ?? { credits: 0 }; const renewal = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10); await admin.from("profiles").update({ sub_active: true, sub_renewal: renewal, credits: p.credits }).eq("id", prof.id); await admin.from("credit_ledger").insert({ user_id: prof.id, delta: p.credits, reason: "monthly_refill" }); } break; }
    case "invoice.payment_failed":
    case "customer.subscription.deleted": { const { data: prof } = await admin.from("profiles").select("id").eq("stripe_customer_id", obj.customer).maybeSingle(); if (prof) { await admin.from("profiles").update({ sub_active: false }).eq("id", prof.id); await admin.from("licenses").update({ status: "deactivated" }).eq("user_id", prof.id).neq("status", "perpetual"); await email(admin, prof.id, "lapse_warning", {}); } break; }
  }
  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});
