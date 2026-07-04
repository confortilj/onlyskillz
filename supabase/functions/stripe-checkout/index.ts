// skillz.ai — stripe-checkout v2
// Plans: Basic $15/60cr · Pro $30/130cr · Developer $60/175cr (annual = 20% off).
// Credit packs at $0.50/credit: 20/$10 · 60/$30 · 120/$60.
// Uses Stripe price IDs from app_config (STRIPE_PRICE_*) with inline price_data fallback.
// Demo mode when STRIPE_SECRET_KEY is unset: simulates success directly in the DB.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const PLANS: Record<string, { cents: number; credits: number; share: number }> = {
  basic:     { cents: 1500, credits: 60,  share: 67 },
  pro:       { cents: 3000, credits: 130, share: 67 },
  developer: { cents: 6000, credits: 175, share: 67 },
  // legacy ids accepted during transition
  starter:    { cents: 1500, credits: 60,  share: 67 },
  enterprise: { cents: 6000, credits: 175, share: 67 },
};
const PACKS: Record<string, { cents: number; credits: number; cfg: string }> = {
  "20":  { cents: 1000, credits: 20,  cfg: "STRIPE_PRICE_TOPUP_20" },
  "60":  { cents: 3000, credits: 60,  cfg: "STRIPE_PRICE_TOPUP_60" },
  "120": { cents: 6000, credits: 120, cfg: "STRIPE_PRICE_TOPUP_120" },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supaUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization")! } },
    });
    const admin = createClient(supaUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);

    const { action, plan, annual, pack, success_url, cancel_url } = await req.json();
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const cfgGet = async (key: string): Promise<string | null> => {
      const { data } = await admin.from("app_config").select("value").eq("key", key).maybeSingle();
      return data?.value ?? null;
    };

    /* ---------- demo mode: no Stripe key yet ---------- */
    if (!stripeKey) {
      if (action === "subscribe") {
        const p = PLANS[plan];
        if (!p) return json({ error: "unknown plan" }, 400);
        const renewal = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
        await admin.from("profiles").update({
          plan, sub_active: true, sub_renewal: renewal, credits: p.credits, revenue_share: p.share,
        }).eq("id", user.id);
        if (p.credits > 0) await admin.from("credit_ledger").insert({ user_id: user.id, delta: p.credits, reason: "monthly_refill" });
        await admin.from("licenses").update({ status: "active" }).eq("user_id", user.id).neq("status", "perpetual");
        return json({ demo: true, ok: true, message: `Demo mode: switched to ${plan}. Set STRIPE_SECRET_KEY to enable real billing.` });
      }
      if (action === "topup") {
        const pk = PACKS[String(pack ?? "60")] ?? PACKS["60"];
        const { data: prof } = await admin.from("profiles").select("credits").eq("id", user.id).single();
        await admin.from("profiles").update({ credits: (prof?.credits ?? 0) + pk.credits }).eq("id", user.id);
        await admin.from("credit_ledger").insert({ user_id: user.id, delta: pk.credits, reason: "topup" });
        return json({ demo: true, ok: true, credits_added: pk.credits });
      }
      if (action === "cancel") {
        await admin.from("profiles").update({ sub_active: false }).eq("id", user.id);
        await admin.from("licenses").update({ status: "deactivated" }).eq("user_id", user.id).neq("status", "perpetual");
        return json({ demo: true, ok: true, message: "Subscription cancelled; non-perpetual licenses deactivated." });
      }
      if (action === "reactivate") {
        await admin.from("profiles").update({ sub_active: true }).eq("id", user.id);
        await admin.from("licenses").update({ status: "active" }).eq("user_id", user.id).neq("status", "perpetual");
        return json({ demo: true, ok: true });
      }
      return json({ error: "unknown action" }, 400);
    }

    /* ---------- live mode: real Stripe ---------- */
    const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
    const stripe = (path: string, body: Record<string, string>) =>
      fetch(`https://api.stripe.com/v1/${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: form(body),
      }).then((r) => r.json());

    const { data: prof } = await admin.from("profiles").select("stripe_customer_id").eq("id", user.id).single();
    let customerId = prof?.stripe_customer_id;
    if (!customerId) {
      const cust = await stripe("customers", { email: user.email ?? "", "metadata[user_id]": user.id });
      customerId = cust.id;
      await admin.from("profiles").update({ stripe_customer_id: customerId }).eq("id", user.id);
    }

    if (action === "subscribe") {
      const canonical = plan === "starter" ? "basic" : plan === "enterprise" ? "developer" : plan;
      const p = PLANS[canonical];
      if (!p) return json({ error: "unknown plan" }, 400);
      const priceId = await cfgGet(`STRIPE_PRICE_${canonical.toUpperCase()}_${annual ? "ANNUAL" : "MONTHLY"}`);
      const line: Record<string, string> = priceId
        ? { "line_items[0][price]": priceId, "line_items[0][quantity]": "1" }
        : {
            "line_items[0][price_data][currency]": "usd",
            "line_items[0][price_data][product_data][name]": `skillz.ai ${canonical} plan`,
            "line_items[0][price_data][recurring][interval]": annual ? "year" : "month",
            "line_items[0][price_data][unit_amount]": String(annual ? Math.round(p.cents * 0.8) * 12 : p.cents),
            "line_items[0][quantity]": "1",
          };
      const session = await stripe("checkout/sessions", {
        customer: customerId!, mode: "subscription", ...line,
        "metadata[user_id]": user.id, "metadata[plan]": canonical,
        success_url: success_url ?? "https://onlyskillz.vercel.app/?billing=success",
        cancel_url: cancel_url ?? "https://onlyskillz.vercel.app/",
      });
      return json({ url: session.url });
    }
    if (action === "topup") {
      const pk = PACKS[String(pack ?? "60")] ?? PACKS["60"];
      const priceId = await cfgGet(pk.cfg);
      const line: Record<string, string> = priceId
        ? { "line_items[0][price]": priceId, "line_items[0][quantity]": "1" }
        : {
            "line_items[0][price_data][currency]": "usd",
            "line_items[0][price_data][product_data][name]": `skillz.ai — ${pk.credits} credits`,
            "line_items[0][price_data][unit_amount]": String(pk.cents),
            "line_items[0][quantity]": "1",
          };
      const session = await stripe("checkout/sessions", {
        customer: customerId!, mode: "payment", ...line,
        "metadata[user_id]": user.id, "metadata[topup_credits]": String(pk.credits),
        success_url: success_url ?? "https://onlyskillz.vercel.app/?topup=1",
        cancel_url: cancel_url ?? "https://onlyskillz.vercel.app/",
      });
      return json({ url: session.url });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
