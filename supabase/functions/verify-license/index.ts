// skillz.ai — verify-license v1: public license verification API
// POST { license_key } → { valid, status, kind, product_id, product_name, product_type, issued_at, checked_at }
// The key itself is the bearer secret; no user identity is returned. Lapsed subscriptions
// deactivate non-perpetual licenses (via stripe-webhook), so `status` is authoritative.
import { createClient } from "jsr:@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { license_key } = await req.json();
    if (!license_key || typeof license_key !== "string" || !/^sk-live-[A-Z2-9]{8}-[A-Z2-9]{8}-[A-Z2-9]{8}$/.test(license_key)) {
      return json({ valid: false, error: "malformed license_key" }, 400);
    }
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: lic } = await admin.from("licenses").select("status, kind, product_id, created_at").eq("license_key", license_key).maybeSingle();
    if (!lic) return json({ valid: false, status: "not_found", checked_at: new Date().toISOString() }, 404);
    const { data: prod } = await admin.from("products").select("name, type, published").eq("id", lic.product_id).maybeSingle();
    const valid = lic.status === "active" || lic.status === "perpetual";
    return json({
      valid, status: lic.status, kind: lic.kind,
      product_id: lic.product_id, product_name: prod?.name ?? null, product_type: prod?.type ?? null,
      issued_at: lic.created_at, checked_at: new Date().toISOString(),
      note: valid ? undefined : "License is deactivated — the buyer's subscription lapsed or the license was revoked.",
    });
  } catch (e) { return json({ valid: false, error: String(e) }, 500); }
});
