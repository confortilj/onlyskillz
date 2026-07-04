// skillz.ai — payout-run v3: monthly seller payouts at a flat 67% (platform keeps 33%).
// Covers credit spends (valued at $0.50/credit) AND seller-priced USD sales.
// Triggered by pg_cron (x-cron) or admin (x-admin-key).
import { createClient } from "jsr:@supabase/supabase-js@2";
const CREDIT_CENTS = 50;      // credits sell at $0.50
const SELLER_SHARE = 67;      // flat 67% to every seller
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
async function email(admin: any, user_id: string, template: string, data: any) { try { await admin.functions.invoke("send-email", { body: { internal_key: Deno.env.get("INTERNAL_KEY") ?? "internal", user_id, template, data } }); } catch (_) { /* */ } }

Deno.serve(async (req: Request) => {
  const adminKey = Deno.env.get("ADMIN_API_KEY"); const isCron = req.headers.get("x-cron") === Deno.env.get("CRON_SECRET");
  if (!isCron && (!adminKey || req.headers.get("x-admin-key") !== adminKey)) return json({ error: "Unauthorized" }, 401);
  try {
    let period: string | undefined; try { period = (await req.json()).period; } catch (_) { /* */ }
    const p = period ?? new Date().toISOString().slice(0, 7);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const from = `${p}-01`; const to = `${p}-31T23:59:59`;
    const { data: ledger } = await admin.from("credit_ledger").select("delta, product_id, created_at").lt("delta", 0).gte("created_at", from).lt("created_at", to);
    const { data: sales } = await admin.from("usd_sales").select("product_id, amount_cents, created_at").gte("created_at", from).lt("created_at", to);
    const { data: products } = await admin.from("products").select("id, designer_id, designer_label");
    const prodMap = new Map((products ?? []).map((x) => [x.id, x]));
    const byDesigner = new Map<string, { label: string; designer_id: string | null; gross: number }>();
    const attribute = (product_id: string, cents: number) => {
      const prod = prodMap.get(product_id); if (!prod) return;
      const key = prod.designer_id ?? prod.designer_label ?? "unattributed";
      const cur = byDesigner.get(key) ?? { label: prod.designer_label, designer_id: prod.designer_id, gross: 0 };
      cur.gross += cents; byDesigner.set(key, cur);
    };
    for (const row of ledger ?? []) attribute(row.product_id, Math.abs(row.delta) * CREDIT_CENTS);
    for (const s of sales ?? []) attribute(s.product_id, s.amount_cents);
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY"); const results = []; let paid = 0; let totalNet = 0; let mode = "demo";
    for (const [, d] of byDesigner) {
      if (!d.designer_id) { results.push({ designer: d.label, gross_cents: d.gross, status: "skipped — seed designer" }); continue; }
      const { data: prof } = await admin.from("profiles").select("stripe_connect_id, connect_status").eq("id", d.designer_id).single();
      const share = SELLER_SHARE; const net = Math.round(d.gross * share / 100);
      const { data: existing } = await admin.from("payouts").select("id").eq("designer_id", d.designer_id).eq("period", p).maybeSingle(); if (existing) { results.push({ designer: d.label, status: "already computed" }); continue; }
      let status = "pending"; let transferId = null;
      if (stripeKey && prof?.stripe_connect_id && !prof.stripe_connect_id.startsWith("acct_demo") && net > 0) { const r = await fetch("https://api.stripe.com/v1/transfers", { method: "POST", headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ amount: String(net), currency: "usd", destination: prof.stripe_connect_id, description: `skillz.ai payout ${p}` }) }).then((x) => x.json()); if (r.id) { status = "paid"; transferId = r.id; mode = "live"; } }
      else if (prof?.connect_status === "active") { status = "paid"; }
      await admin.from("payouts").insert({ designer_id: d.designer_id, period: p, gross_cents: d.gross, share_pct: share, net_cents: net, status, stripe_transfer_id: transferId });
      if (status === "paid") { paid++; totalNet += net; await email(admin, d.designer_id, "payout_sent", { period: p, net_cents: net, share, mode }); }
      results.push({ designer: d.label, gross_cents: d.gross, share_pct: share, net_cents: net, status });
    }
    await admin.from("payout_runs").insert({ period: p, designers_paid: paid, total_net_cents: totalNet, mode });
    return json({ ok: true, period: p, designers_paid: paid, total_net_cents: totalNet, mode, results });
  } catch (e) { return json({ error: String(e) }, 500); }
});
