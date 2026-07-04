// skillz.ai — studio-stats v1: real seller dashboard data + seller product actions
// GET data: own products, sales (credits + USD, with 33% fee shown), payouts, simple pricing suggestions.
// Actions: set_price (seller-priced fields only), unpublish, republish — ownership enforced server-side.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const CREDIT_CENTS = 50; const SELLER_SHARE = 0.67;
const USD_PRICEABLE = ["dataset", "avatar", "voice", "model", "rag", "eval", "assets"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supaUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization")! } } });
    const admin = createClient(supaUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);

    let body: any = {}; try { body = await req.json(); } catch { /* GET-style */ }

    // ---- seller actions ----
    if (body.action) {
      const { data: prod } = await admin.from("products").select("id, type, designer_id, published, credits_price, price_usd_cents").eq("id", body.product_id).maybeSingle();
      if (!prod) return json({ error: "Product not found" }, 404);
      if (prod.designer_id !== user.id) return json({ error: "You can only manage your own products" }, 403);
      if (body.action === "set_price") {
        if (!USD_PRICEABLE.includes(prod.type)) return json({ error: `${prod.type}s are auto-priced in credits and cannot be repriced` }, 400);
        const cents = Math.round(Number(body.price_usd_cents));
        if (!Number.isFinite(cents) || cents < 0 || cents > 10_000_00) return json({ error: "price_usd_cents must be 0–1,000,000 (i.e. up to $10,000)" }, 400);
        if ((prod.type === "avatar" || prod.type === "voice") && cents === 0) return json({ error: "Commercial license price must be > 0 (or leave unset)" }, 400);
        await admin.from("products").update({ price_usd_cents: cents }).eq("id", prod.id);
        return json({ ok: true, product_id: prod.id, price_usd_cents: cents });
      }
      if (body.action === "unpublish") { await admin.from("products").update({ published: false }).eq("id", prod.id); return json({ ok: true, published: false }); }
      if (body.action === "republish") { await admin.from("products").update({ published: true }).eq("id", prod.id); return json({ ok: true, published: true }); }
      return json({ error: "unknown action" }, 400);
    }

    // ---- dashboard data ----
    const { data: products } = await admin.from("products").select("*").eq("designer_id", user.id);
    const ids = (products ?? []).map((p) => p.id);
    const monthAgo = new Date(Date.now() - 30 * 864e5).toISOString();
    let creditSales: any[] = []; let usdSales: any[] = [];
    if (ids.length) {
      ({ data: creditSales } = await admin.from("credit_ledger").select("product_id, delta, created_at").in("product_id", ids).lt("delta", 0) as any);
      ({ data: usdSales } = await admin.from("usd_sales").select("product_id, amount_cents, platform_fee_cents, seller_net_cents, refunded_at, created_at").in("product_id", ids) as any);
    }
    const { data: payouts } = await admin.from("payouts").select("period, gross_cents, share_pct, net_cents, status").eq("designer_id", user.id).order("period", { ascending: false });
    const { data: profile } = await admin.from("profiles").select("connect_status, revenue_share").eq("id", user.id).single();

    const perProduct = (products ?? []).map((p) => {
      const cs = (creditSales ?? []).filter((r) => r.product_id === p.id);
      const us = (usdSales ?? []).filter((r) => r.product_id === p.id && !r.refunded_at);
      const grossCents = cs.reduce((a, r) => a + Math.abs(r.delta) * CREDIT_CENTS, 0) + us.reduce((a, r) => a + r.amount_cents, 0);
      const sales30 = cs.filter((r) => r.created_at >= monthAgo).length + us.filter((r) => r.created_at >= monthAgo).length;
      return { id: p.id, name: p.name, type: p.type, published: p.published, credits_price: p.credits_price, price_usd_cents: p.price_usd_cents, size_tier: p.size_tier,
        downloads: p.downloads, rating: p.rating, score: p.score, sales_count: cs.length + us.length, sales_30d: sales30,
        gross_cents: grossCents, net_cents: Math.round(grossCents * SELLER_SHARE) };
    });

    // simple pricing suggestions
    const suggestions: string[] = [];
    for (const p of perProduct) {
      if (!p.published) suggestions.push(`"${p.name}" is unpublished — republish it to start selling again.`);
      if (USD_PRICEABLE.includes(p.type) && (p.price_usd_cents ?? 0) > 0 && p.sales_30d === 0 && p.downloads < 5)
        suggestions.push(`"${p.name}" has no sales in 30 days — consider lowering the price or improving the listing docs.`);
      if ((p.rating ?? 5) < 4 && p.sales_count > 3)
        suggestions.push(`"${p.name}" is rated ${p.rating}★ — buyer feedback suggests quality issues; an update could recover sales.`);
      if (p.score != null && p.score < 90)
        suggestions.push(`"${p.name}" scores ${p.score}/100 on security — reaching 90+ earns the Verified Safe badge and better placement.`);
    }
    if (profile?.connect_status !== "active") suggestions.push("Set up Stripe Connect payouts to receive your 67% share automatically each month.");

    const totalGross = perProduct.reduce((a, p) => a + p.gross_cents, 0);
    return json({ ok: true,
      products: perProduct,
      totals: { gross_cents: totalGross, net_cents: Math.round(totalGross * SELLER_SHARE), platform_fee_cents: totalGross - Math.round(totalGross * SELLER_SHARE), sales: perProduct.reduce((a, p) => a + p.sales_count, 0), downloads: perProduct.reduce((a, p) => a + p.downloads, 0) },
      payouts: payouts ?? [], connect_status: profile?.connect_status ?? "none", share_pct: 67, suggestions });
  } catch (e) { return json({ error: String(e) }, 500); }
});
