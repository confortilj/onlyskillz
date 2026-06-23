// skillz.ai — stripe-checkout
// Creates Stripe Checkout sessions for subscriptions and credit top-ups.
// Demo mode when STRIPE_SECRET_KEY is unset: simulates success directly in the DB
// so the full product loop is testable before Stripe keys arrive.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const PLANS: Record<string, { cents: number; credits: number; share: number }> = {
  free:       { cents: 0,    credits: 0,   share: 60 },
  starter:    { cents: 999,  credits: 20,  share: 60 },
  pro:        { cents: 2499, credits: 60,  share: 70 },
  enterprise: { cents: 9999, credits: 200, share: 80 },
};
const TOPUP = { cents: 1499, credits: 50 };

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

    const { action, plan, annual, success_url, cancel_url } = await req.json();
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");

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
        const { data: prof } = await admin.from("profiles").select("credits").eq("id", user.id).single();
        await admin.from("profiles").update({ credits: (prof?.credits ?? 0) + TOPUP.credits }).eq("id", user.id);
        await admin.from("credit_ledger").insert({ user_id: user.id, delta: TOPUP.credits, reason: "topup" });
        return json({ demo: true, ok: true, credits_added: TOPUP.credits });
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
      const p = PLANS[plan];
      const cents = annual ? Math.round(p.cents * 0.8) : p.cents;
      const session = await stripe("checkout/sessions", {
        customer: customerId!, mode: "subscription",
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][product_data][name]": `skillz.ai ${plan} plan`,
        "line_items[0][price_data][recurring][interval]": annual ? "year" : "month",
        "line_items[0][price_data][unit_amount]": String(annual ? cents * 12 : cents),
        "line_items[0][quantity]": "1",
        "metadata[user_id]": user.id, "metadata[plan]": plan,
        success_url: success_url ?? "https://skillz.ai/billing?success=1",
        cancel_url: cancel_url ?? "https://skillz.ai/pricing",
      });
      return json({ url: session.url });
    }
    if (action === "topup") {
      const session = await stripe("checkout/sessions", {
        customer: customerId!, mode: "payment",
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][product_data][name]": "skillz.ai — 50 credits",
        "line_items[0][price_data][unit_amount]": String(TOPUP.cents),
        "line_items[0][quantity]": "1",
        "metadata[user_id]": user.id, "metadata[topup_credits]": String(TOPUP.credits),
        success_url: success_url ?? "https://skillz.ai/billing?topup=1",
        cancel_url: cancel_url ?? "https://skillz.ai/billing",
      });
      return json({ url: session.url });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
