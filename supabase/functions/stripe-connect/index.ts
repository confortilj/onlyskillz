// skillz.ai — stripe-connect: designer payout onboarding.
// action 'onboard' creates an Express Connect account + onboarding link (live),
// or simulates activation (demo). action 'status' returns current state.
import { createClient } from "jsr:@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supaUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization")! } } });
    const admin = createClient(supaUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);
    const { action, return_url } = await req.json();
    const { data: prof } = await admin.from("profiles").select("stripe_connect_id, connect_status, revenue_share").eq("id", user.id).single();
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");

    if (action === "status") return json({ connect_status: prof?.connect_status ?? "none", has_account: !!prof?.stripe_connect_id, revenue_share: prof?.revenue_share ?? 60 });

    if (action === "onboard") {
      await admin.from("profiles").update({ is_designer: true }).eq("id", user.id);
      if (!stripeKey) {
        await admin.from("profiles").update({ connect_status: "active", stripe_connect_id: "acct_demo_" + user.id.slice(0, 8) }).eq("id", user.id);
        return json({ demo: true, connect_status: "active", message: "Demo: payout account activated. Add STRIPE_SECRET_KEY for real Connect onboarding." });
      }
      const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
      const stripe = (path: string, body: Record<string, string>) => fetch(`https://api.stripe.com/v1/${path}`, { method: "POST", headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form(body) }).then((r) => r.json());
      let acct = prof?.stripe_connect_id;
      if (!acct) { const a = await stripe("accounts", { type: "express", "capabilities[transfers][requested]": "true", "metadata[user_id]": user.id }); acct = a.id; await admin.from("profiles").update({ stripe_connect_id: acct, connect_status: "pending" }).eq("id", user.id); }
      const link = await stripe("account_links", { account: acct!, type: "account_onboarding", refresh_url: return_url ?? "https://skillz.ai/dashboard", return_url: return_url ?? "https://skillz.ai/dashboard" });
      return json({ url: link.url, connect_status: "pending" });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) { return json({ error: String(e) }, 500); }
});
