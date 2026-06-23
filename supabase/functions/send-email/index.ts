// skillz.ai — send-email: transactional email (receipts, lapse warnings, welcome, payout).
// Sends via Resend when RESEND_API_KEY is set; otherwise logs to email_log (demo mode).
// Internal-only: requires matching INTERNAL_KEY (passed by other edge functions) or x-admin-key.
import { createClient } from "jsr:@supabase/supabase-js@2";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const FROM = "skillz.ai <noreply@skillz.ai>";

function render(template: string, data: any): { subject: string; html: string } {
  switch (template) {
    case "welcome":
      return { subject: "Welcome to skillz.ai — your Free plan is live",
        html: `<h2>Welcome to skillz.ai</h2><p>Your account is ready on the <b>Free</b> plan with 3 active licenses. Browse 500+ security-scanned AI powerups and upgrade anytime for credits and unlimited skills.</p><p>Every item you download is forensically watermarked to your account — keep your licenses to yourself.</p>` };
    case "receipt":
      return { subject: `Your skillz.ai license — ${data.product}`,
        html: `<h2>License issued</h2><p>You now have access to <b>${data.product}</b>.</p><ul><li>License key: <code>${data.license}</code></li><li>Type: ${data.kind}</li><li>Protection: ${data.watermark}</li></ul><p>This copy is individually fingerprinted to your account. Redistribution violates the Terms of Service and is traceable back to you.</p>` };
    case "lapse_warning":
      return { subject: "⚠️ Your skillz.ai skills are about to deactivate",
        html: `<h2>Your subscription lapsed</h2><p>Your payment didn't go through, so your downloaded skills and rentals are now in <b>read-only / deactivated</b> mode and will stop working until you reactivate.</p><p>Avatar buyouts remain yours. <a href="https://skillz.ai/billing">Reactivate now</a> to restore everything instantly.</p>` };
    case "payout_sent":
      return { subject: `💰 skillz.ai payout — ${data.period}`,
        html: `<h2>You got paid</h2><p>Your ${data.period} payout of <b>$${(data.net_cents / 100).toFixed(2)}</b> (at your ${data.share}% share) has been ${data.mode === "live" ? "transferred to your connected account" : "recorded — connect a payout account to receive it"}.</p>` };
    default: return { subject: "skillz.ai", html: "<p>Notification.</p>" };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  try {
    const body = await req.json();
    const internalOk = body.internal_key && body.internal_key === (Deno.env.get("INTERNAL_KEY") ?? "internal");
    const adminOk = req.headers.get("x-admin-key") && req.headers.get("x-admin-key") === Deno.env.get("ADMIN_API_KEY");
    if (!internalOk && !adminOk) return json({ error: "Unauthorized" }, 401);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    let toEmail = body.to_email;
    if (!toEmail && body.user_id) { const { data } = await admin.auth.admin.getUserById(body.user_id); toEmail = data?.user?.email; }
    if (!toEmail) return json({ error: "no recipient" }, 400);
    const { subject, html } = render(body.template, body.data ?? {});
    const key = Deno.env.get("RESEND_API_KEY");
    let status = "logged_demo"; let providerId = null;
    if (key) {
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: FROM, to: toEmail, subject, html }) }).then((x) => x.json());
      if (r.id) { status = "sent"; providerId = r.id; } else status = "failed";
    }
    await admin.from("email_log").insert({ user_id: body.user_id ?? null, to_email: toEmail, template: body.template, subject, status, provider_id: providerId, meta: body.data ?? {} });
    return json({ ok: true, status, to: toEmail, subject, demo: !key });
  } catch (e) { return json({ error: String(e) }, 500); }
});
