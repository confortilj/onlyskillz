// skillz.ai — submit-product v2: designer upload + DEEP automated security scan
import { createClient } from "jsr:@supabase/supabase-js@2";
import { deepScan } from "./scanner.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const rand = (n: number) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map((b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join(""); };
const SUMMARY: Record<string, string> = { critical: "fail", high: "fail", medium: "warn", low: "warn" };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supaUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization")! } } });
    const admin = createClient(supaUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);
    const body = await req.json();
    const { name, type = "skill", category = "Productivity", tier = "pro", version = "1.0.0", description = "", docs_markdown = "", llms = [] } = body;
    if (!name) return json({ error: "name required" }, 400);
    const { data: profile } = await admin.from("profiles").select("*").eq("id", user.id).single();
    if (!profile?.is_designer) await admin.from("profiles").update({ is_designer: true }).eq("id", user.id);

    const scan = deepScan(`${name}\n${description}\n${docs_markdown}`);
    const published = scan.verdict === "published";
    const summaryChecks = (() => {
      const cats = ["malicious-code", "exfiltration", "injection", "secrets", "obfuscation", "permissions", "dependencies"];
      return cats.map((cat) => {
        const hits = scan.findings.filter((f) => f.category === cat);
        const worst = hits.sort((a, b) => ["info", "low", "medium", "high", "critical"].indexOf(b.severity) - ["info", "low", "medium", "high", "critical"].indexOf(a.severity))[0];
        const label = { "malicious-code": "Malicious code", exfiltration: "Data exfiltration", injection: "Hidden injection", secrets: "Credential leakage", obfuscation: "Obfuscation analysis", permissions: "Permission scoping", dependencies: "Dependency audit" }[cat]!;
        if (!worst) return { name: label, status: "pass", note: "No issues detected." };
        return { name: label, status: SUMMARY[worst.severity] ?? "warn", note: `${worst.title} (${worst.cwe}): ${worst.detail}` };
      });
    })();

    const id = `${slugify(name)}-${rand(4)}`;
    const designerLabel = `${profile?.display_name ?? "Designer"} @${profile?.handle ?? "designer"}`;
    const bundlePath = `${id}/SKILL.md`;
    await admin.storage.from("bundles").upload(bundlePath, new Blob([docs_markdown || description], { type: "text/markdown" }), { upsert: true });

    const { error: insErr } = await admin.from("products").insert({
      id, type, name, icon: body.icon ?? "🧩", description, category, tier, version, designer_id: user.id, designer_label: designerLabel,
      llms, score: scan.score, rating: null, upvotes: 0, downloads: 0, featured: false, trend_rank: 999,
      docs: { overview: description, usage: docs_markdown ? docs_markdown.slice(0, 2000) : "Documentation pending.", install: `npx skillz add ${id} --key $SKILLZ_LICENSE`, examples: [] },
      security: { scanned: new Date().toISOString().slice(0, 10), checks: summaryChecks },
      bundle_path: bundlePath, published,
    });
    if (insErr) return json({ error: insErr.message }, 500);

    await admin.from("scan_reports").insert({ product_id: id, submitted_by: user.id, score: scan.score, verdict: scan.verdict, findings: scan.findings, dynamic_scan_status: published ? "queued" : "skipped", engine_version: "static-2.0" });

    const msg = scan.verdict === "published" ? `Published — score ${scan.score}/100${scan.score >= 90 ? " · Verified Safe badge" : ""}. Dynamic sandbox scan queued.`
      : scan.verdict === "needs_review" ? `Score ${scan.score}/100 — flagged for manual review before publishing (sensitive findings present).`
      : `Score ${scan.score}/100 — BLOCKED. Critical issues must be resolved before resubmitting.`;
    return json({ ok: true, product_id: id, published, verdict: scan.verdict, scan: { score: scan.score, verdict: scan.verdict, findings: scan.findings, checks: summaryChecks }, message: msg });
  } catch (e) { return json({ error: String(e) }, 500); }
});
