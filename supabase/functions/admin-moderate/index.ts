// skillz.ai — admin-moderate v1: moderation queue + product actions + refunds
// Auth: x-admin-key header (ADMIN_API_KEY secret). Actions:
//   queue                     → products needing review (scan verdict needs_review or unpublished with findings)
//   approve {product_id}      → publish
//   unpublish {product_id}    → take down (+ optional takedown log with reason)
//   refund {sale_id}          → Stripe refund of a usd_sales row, revokes the license
import { createClient } from "jsr:@supabase/supabase-js@2";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key", "Access-Control-Allow-Methods": "POST, OPTIONS" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  const adminKey = Deno.env.get("ADMIN_API_KEY");
  if (!adminKey || req.headers.get("x-admin-key") !== adminKey) return json({ error: "Unauthorized" }, 401);
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    let body: any = {}; try { body = await req.json(); } catch { /* */ }
    const action = body.action ?? "queue";

    if (action === "queue") {
      const { data: reports } = await admin.from("scan_reports").select("product_id, submitted_by, score, verdict, findings, created_at").in("verdict", ["needs_review", "blocked"]).order("created_at", { ascending: false }).limit(50);
      const ids = [...new Set((reports ?? []).map((r) => r.product_id))];
      let prods: any[] = [];
      if (ids.length) ({ data: prods } = await admin.from("products").select("id, name, type, designer_label, published, score").in("id", ids) as any);
      const pmap = new Map((prods ?? []).map((p) => [p.id, p]));
      const queue = (reports ?? []).map((r) => ({ ...r, product: pmap.get(r.product_id) ?? null }));
      const { data: takedowns } = await admin.from("takedowns").select("*").order("created_at", { ascending: false }).limit(20);
      const { data: recentSales } = await admin.from("usd_sales").select("id, product_id, user_id, amount_cents, refunded_at, stripe_payment_intent, created_at").order("created_at", { ascending: false }).limit(20);
      const { data: userReports } = await admin.from("product_reports").select("id, product_id, reason, created_at").order("created_at", { ascending: false }).limit(20);
      return json({ ok: true, queue, takedowns: takedowns ?? [], recent_sales: recentSales ?? [], reports: userReports ?? [] });
    }

    if (action === "approve" || action === "unpublish") {
      if (!body.product_id) return json({ error: "product_id required" }, 400);
      const published = action === "approve";
      const { error } = await admin.from("products").update({ published }).eq("id", body.product_id);
      if (error) return json({ error: error.message }, 500);
      if (!published && body.reason) {
        await admin.from("takedowns").insert({ product_id: body.product_id, reason: body.reason, source: "admin-moderation" }).then(() => {}, () => {}); // best-effort; table shape may vary
      }
      return json({ ok: true, product_id: body.product_id, published });
    }

    if (action === "refund") {
      if (!body.sale_id) return json({ error: "sale_id required" }, 400);
      const { data: sale } = await admin.from("usd_sales").select("*").eq("id", body.sale_id).maybeSingle();
      if (!sale) return json({ error: "Sale not found" }, 404);
      if (sale.refunded_at) return json({ error: "Already refunded" }, 400);
      let refundId: string | null = null;
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
      if (stripeKey && sale.stripe_payment_intent) {
        const r = await fetch("https://api.stripe.com/v1/refunds", { method: "POST", headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ payment_intent: sale.stripe_payment_intent }) }).then((x) => x.json());
        if (r.error) return json({ error: `Stripe refund failed: ${r.error.message}` }, 502);
        refundId = r.id;
      }
      await admin.from("usd_sales").update({ refunded_at: new Date().toISOString(), stripe_refund_id: refundId }).eq("id", sale.id);
      if (sale.license_id) await admin.from("licenses").update({ status: "deactivated" }).eq("id", sale.license_id);
      return json({ ok: true, sale_id: sale.id, stripe_refund_id: refundId, license_revoked: !!sale.license_id, mode: refundId ? "live" : "recorded-only (no Stripe key or payment intent)" });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) { return json({ error: String(e) }, 500); }
});
